#!/usr/bin/env node
/*
 * repair-session-log.mjs — check and repair a DeepSeek Harness session log.
 *
 * Background: a harness bug can write duplicate seq ranges into a live
 * session log at seed-end/inbox-splice boundaries. The strict loader then
 * refuses the log with:
 *   "corrupt session log: seq gap in committed region ... (expected N, got M)"
 * This tool detects the duplicated regions and removes the stale first copy
 * (the copy that ends with turn/end + session/end-seed), keeping the real
 * continuation.
 *
 * Usage:
 *   node repair-session-log.mjs <path-to-session.jsonl.zstd>          # check only
 *   node repair-session-log.mjs <path-to-session.jsonl.zstd> --fix    # check + repair
 *
 * A timestamped backup is written next to the log before any modification.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';

const ZSTD_MAGIC = 4247762216;

function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error('invalid frame magic at byte ' + offset);
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const d = buffer.readUInt8(offset);
    offset += 1;
    if ((d & 24) !== 0) throw new Error('reserved frame-header bit at byte ' + (offset - 1));
    const csf = d >>> 6;
    const ss = (d & 32) !== 0;
    const chk = (d & 4) !== 0;
    const df = d & 3;
    const db = df === 3 ? 4 : df;
    const csb = csf === 0 ? (ss ? 1 : 0) : (1 << csf);
    const rhb = (ss ? 0 : 1) + db + csb;
    if (buffer.length - offset < rhb) return { frames, tornStart: start };
    offset += rhb;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const bh = buffer.readUIntLE(offset, 3);
      offset += 3;
      const last = (bh & 1) !== 0;
      const bt = (bh >>> 1) & 3;
      const bs = bh >>> 3;
      if (bt === 3) throw new Error('reserved block type at byte ' + (offset - 3));
      const pb = bt === 1 ? 1 : bs;
      if (buffer.length - offset < pb) return { frames, tornStart: start };
      offset += pb;
      if (last) break;
    }
    if (chk) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return { frames };
}

function decodeLines(buffer, frames) {
  // returns { lineIndex -> { frame, text } } plus raw lines
  const lines = [];
  for (let fi = 0; fi < frames.length; fi++) {
    const pt = zstdDecompressSync(buffer.subarray(frames[fi].start, frames[fi].end)).toString('utf8');
    for (const l of pt.split('\n')) {
      if (l.length === 0) continue;
      lines.push({ frame: fi, text: l });
    }
  }
  return lines;
}

async function loadDecoder() {
  const { decodeStorageRecord } = await import('@deepseek-ai/dsh-session');
  return decodeStorageRecord;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 2 || (args.length === 2 && args[1] !== '--fix')) {
    console.error('usage: node repair-session-log.mjs <session.jsonl.zstd> [--fix]');
    process.exit(2);
  }
  const logPath = args[0];
  const doFix = args[1] === '--fix';
  const decodeStorageRecord = await loadDecoder();

  let buffer = readFileSync(logPath);
  let rounds = 0;
  for (;;) {
    rounds++;
    const { frames, tornStart } = scanZstdFrames(buffer);
    const lines = decodeLines(buffer, frames);
    let counter = 0;
    let error = null;
    const eventPos = new Map(); // seq -> { frame, firstLineIdx }
    for (let li = 0; li < lines.length; li++) {
      const { frame, text } = lines[li];
      let record;
      try { record = JSON.parse(text); } catch (e) { error = 'unparsable line #' + (li + 1); break; }
      if (record.type === 'session') continue;
      let events;
      try { events = decodeStorageRecord(record); } catch (e) { error = 'decode failure at line #' + (li + 1) + ': ' + e.message; break; }
      for (const ev of events) {
        if (ev.seq !== counter) {
          error = 'seq gap at line #' + (li + 1) + ' (expected ' + counter + ', got ' + ev.seq + ', type ' + ev.type + ')';
          break;
        }
        eventPos.set(counter, { frame, lineIdx: li });
        counter++;
      }
      if (error) break;
    }

    if (!error) {
      console.log('OK: ' + counter + ' events contiguous, ' + lines.length + ' lines, ' + frames.length + ' frames' + (tornStart !== undefined ? ', torn tail at ' + tornStart : '') + (rounds > 1 ? ' (repaired in ' + rounds + ' passes)' : ''));
      return;
    }

    console.log('GAP DETECTED (pass ' + rounds + '): ' + error);
    if (!doFix) {
      console.log('run with --fix to repair (a backup will be written first)');
      process.exit(1);
    }

    // Find the duplicated seq range and the stale first copy.
    // The violation reports: expected E, got S (S < E). Duplicated seqs = [S, E-1].
    const m = error.match(/expected (\d+), got (\d+)/);
    if (!m) { console.error('cannot parse violation; aborting'); process.exit(1); }
    const E = Number(m[1]);
    const S = Number(m[2]);
    if (S >= E) { console.error('unexpected violation shape; aborting'); process.exit(1); }

    // Locate the first occurrence of S (its frame), and check the frames of the
    // stale copy: the first occurrence of each seq in [S, E-1] plus a following
    // session/end-seed, all before the re-emission.
    const staleFrames = new Set();
    for (let seq = S; seq < E; seq++) {
      if (eventPos.has(seq)) staleFrames.add(eventPos.get(seq).frame);
    }
    // find the frame containing the end-seed immediately after the last stale event
    const lastStale = eventPos.get(E - 1);
    if (!lastStale) { console.error('cannot locate stale region; aborting'); process.exit(1); }
    let endSeedFrame = -1;
    for (let li = lastStale.lineIdx + 1; li < lines.length && lines[li].frame <= lastStale.frame + 2; li++) {
      try {
        const rec = JSON.parse(lines[li].text);
        if (rec.type === 'session/end-seed') { endSeedFrame = lines[li].frame; break; }
      } catch { /* skip */ }
    }
    if (endSeedFrame >= 0) staleFrames.add(endSeedFrame);

    if (staleFrames.size === 0) {
      console.error('no stale frames identified; aborting (log left unchanged)');
      process.exit(1);
    }

    const keep = [];
    for (let fi = 0; fi < frames.length; fi++) {
      if (staleFrames.has(fi)) continue;
      keep.push(buffer.subarray(frames[fi].start, frames[fi].end));
    }
    const newBuffer = Buffer.concat(keep);
    console.log('removing stale frames ' + [...staleFrames].join(', ') + ' (' + (buffer.length - newBuffer.length) + ' bytes)');

    if (!existsSync(logPath + '.repair-backup')) {
      writeFileSync(logPath + '.repair-backup', buffer);
      console.log('backup written: ' + logPath + '.repair-backup');
    }
    writeFileSync(logPath, newBuffer);
    buffer = newBuffer;
    if (rounds > 10) { console.error('too many repair passes; aborting'); process.exit(1); }
  }
}

main().catch((e) => { console.error('FATAL:', e && e.stack ? e.stack : e); process.exit(1); });
