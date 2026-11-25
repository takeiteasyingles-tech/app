// ElevenLabs: Instant Voice Clone from a sample, then Eleven v3 TTS with audio tags (emotion).
// Usage:
//   node eleven.mjs clone <name> <sample.mp3> <out.json>      -> creates the cloned voice, saves voice_id
//   node eleven.mjs tts <voice.json> <lines.json> <outDir>     -> lines.json = [{ "id": "voice1", "text": "[warmly] ..." }]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV = fileURLToPath(new URL('../../.env', import.meta.url));
const KEY = readFileSync(ENV, 'utf8')
  .match(/^ELEVENLABS_API_KEY=(.*)$/m)?.[1]
  ?.trim();
if (!KEY) {
  console.error('ELEVENLABS_API_KEY missing in .env');
  process.exit(2);
}
const API = 'https://api.elevenlabs.io/v1';
const H = { 'xi-api-key': KEY };

async function clone(name, sample, out) {
  const fd = new FormData();
  fd.append('name', name);
  fd.append('description', 'Take It Easy: assistant voice (instant clone)');
  fd.append('files', new Blob([readFileSync(sample)], { type: 'audio/mpeg' }), basename(sample));
  const r = await fetch(`${API}/voices/add`, { method: 'POST', headers: H, body: fd });
  const j = await r.json();
  if (!r.ok) throw new Error(`clone failed ${r.status}: ${JSON.stringify(j)}`);
  writeFileSync(out, JSON.stringify({ name, voice_id: j.voice_id }, null, 2));
  console.log(`voice ${j.voice_id}`);
}

async function tts(voiceFile, linesFile, outDir) {
  const { voice_id } = JSON.parse(readFileSync(voiceFile, 'utf8'));
  mkdirSync(outDir, { recursive: true });
  for (const { id, text } of JSON.parse(readFileSync(linesFile, 'utf8'))) {
    const r = await fetch(`${API}/text-to-speech/${voice_id}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json' },
      // v3 stability: 0 creative, 0.5 natural, 1 robust. Audio tags ([warmly], [laughs]) need 0 or 0.5.
      body: JSON.stringify({ text, model_id: 'eleven_v3', voice_settings: { stability: 0.5, similarity_boost: 0.8 } }),
    });
    if (!r.ok) throw new Error(`tts ${id} failed ${r.status}: ${await r.text()}`);
    writeFileSync(`${outDir}/${id}.mp3`, Buffer.from(await r.arrayBuffer()));
    console.log(`saved ${outDir}/${id}.mp3`);
  }
}

const [cmd, a, b, c] = process.argv.slice(2);
if (cmd === 'clone') await clone(a, b, c);
else if (cmd === 'tts') await tts(a, b, c);
else console.log('usage: clone <name> <sample> <out.json> | tts <voice.json> <lines.json> <outDir>');
