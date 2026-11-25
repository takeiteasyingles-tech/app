// Minimal kie.ai client: upload a file, run a market task, poll, download results.
// Usage:
//   node kie.mjs upload <file>                     -> prints the hosted URL
//   node kie.mjs run <task.json> <outPrefix>       -> creates the task, waits, downloads results
//   node kie.mjs credit
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV = fileURLToPath(new URL('../../.env', import.meta.url));
const KEY = readFileSync(ENV, 'utf8')
  .match(/^KIE_IA_KEY=(.*)$/m)?.[1]
  ?.trim();
if (!KEY) throw new Error('KIE_IA_KEY missing');
const H = { Authorization: `Bearer ${KEY}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function upload(file) {
  const fd = new FormData();
  fd.append('file', new Blob([readFileSync(file)]), basename(file));
  fd.append('uploadPath', 'tie-avatars');
  fd.append('fileName', `${Date.now()}-${basename(file)}`);
  const r = await fetch('https://kieai.redpandaai.co/api/file-stream-upload', { method: 'POST', headers: H, body: fd });
  const j = await r.json();
  if (!j.success && j.code !== 200) throw new Error(`upload failed: ${JSON.stringify(j)}`);
  return j.data.downloadUrl ?? j.data.fileUrl;
}

async function run(taskFile, outPrefix) {
  const body = JSON.parse(readFileSync(taskFile, 'utf8'));
  const r = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (j.code !== 200) throw new Error(`createTask failed: ${JSON.stringify(j)}`);
  const id = j.data.taskId;
  console.log(`task ${id} (${body.model})`);
  const t0 = Date.now();
  for (;;) {
    await sleep(8000);
    const q = await (await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${id}`, { headers: H })).json();
    const d = q.data ?? {};
    if (d.state === 'success') {
      const res = JSON.parse(d.resultJson);
      console.log(`done in ${Math.round((Date.now() - t0) / 1000)}s, credits ${d.creditsConsumed ?? '?'}`);
      writeFileSync(
        `${outPrefix}.result.json`,
        JSON.stringify({ taskId: id, ...res, creditsConsumed: d.creditsConsumed }, null, 2),
      );
      let i = 0;
      for (const url of res.resultUrls ?? []) {
        const ext = extname(new URL(url).pathname) || '.bin';
        const dest = `${outPrefix}${i ? `-${i}` : ''}${ext}`;
        writeFileSync(dest, Buffer.from(await (await fetch(url)).arrayBuffer()));
        console.log(`saved ${dest}`);
        i++;
      }
      return;
    }
    if (d.state === 'fail') throw new Error(`task failed: ${d.failCode} ${d.failMsg}`);
    process.stdout.write(`${d.state ?? q.msg} `);
  }
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'upload') console.log(await upload(a));
else if (cmd === 'run') await run(a, b);
else if (cmd === 'credit')
  console.log((await (await fetch('https://api.kie.ai/api/v1/chat/credit', { headers: H })).json()).data);
else console.log('usage: upload <file> | run <task.json> <outPrefix> | credit');
