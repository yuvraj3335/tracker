import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const guides = JSON.parse(await fs.readFile(new URL('../data/guides/index.json', import.meta.url), 'utf8'));
const seed = JSON.parse(await fs.readFile(new URL('../data/a2z-seed.json', import.meta.url), 'utf8'));
const questions = seed.sections.flatMap(s => s.headings.flatMap(h => h.questions));
await fs.mkdir('build/guide-tests', { recursive: true });
let assertions = 0;
const javaFiles = [], classes = [];
for (const [number, guide] of Object.entries(guides)) {
  if (!questions.some(q => q.globalOrder + 1 === Number(number))) throw new Error(`Unknown question ${number}`);
  for (const field of ['problem', 'assumptions', 'baseline', 'approach', 'java', 'time', 'space']) if (typeof guide[field] !== 'string' || !guide[field].trim()) throw new Error(`Question ${number} missing ${field}`);
  for (const field of ['input', 'output', 'explanation']) if (!guide.example?.[field]) throw new Error(`Question ${number} missing example ${field}`);
  if (!guide.steps?.length || !guide.pitfalls?.length || !guide.tests?.length) throw new Error(`Question ${number} missing checks or reasoning`);
  if (guide.trace && (!guide.trace.columns?.length || !guide.trace.rows?.length || guide.trace.rows.some(row => row.length !== guide.trace.columns.length))) throw new Error(`Question ${number} has an incomplete walkthrough table`);
  if (!guide.reference?.url?.startsWith('https://takeuforward.org/') || !guide.reference.title || !guide.reference.approach || !guide.reference.checkedOn) throw new Error(`Question ${number} has an incomplete source check`);
  if (guide.better && ['explanation', 'java', 'time', 'space'].some(field => !guide.better[field]?.trim())) throw new Error(`Question ${number} has an incomplete intermediate approach`);
  if (process.argv.includes('--java')) {
    const name = `Guide${number}Test`;
    const file = `build/guide-tests/${name}.java`;
    await fs.writeFile(file, `import java.util.*;\nimport java.io.*;\nimport java.math.*;\npublic class ${name} {\n${guide.baselineJava ?? ''}\n${guide.better?.java ?? ''}\n${guide.java}\npublic static void main(String[] args) throws Exception {\n${guide.tests.map(check => `{ ${check} }`).join('\n')}\n}\n}\n`);
    javaFiles.push(file); classes.push(name);

  }
  assertions += guide.tests.length;
}
if (process.argv.includes('--java') && javaFiles.length) {
  const runner = 'build/guide-tests/AllGuidesTest.java';
  await fs.writeFile(runner, `public class AllGuidesTest { public static void main(String[] args) throws Exception {\n${classes.map(name => `${name}.main(args);`).join('\n')}\n} }`);
  for (const [command, args] of [['javac', [...javaFiles, runner]], ['java', ['-ea', '-cp', 'build/guide-tests', 'AllGuidesTest']]]) {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120000 });
    if (result.status !== 0) throw new Error(`${command}: ${result.error || result.stderr || result.stdout}`);
  }
}
const missing = questions.filter(q => !guides[String(q.globalOrder + 1)]).map(q => `${q.globalOrder + 1}: ${q.name}`);
console.log(`${Object.keys(guides).length}/${questions.length} authored guides; ${assertions} Java check blocks${process.argv.includes('--java') ? ' passed' : ' prepared (not executed)'}.`);
await fs.writeFile('build/guide-coverage.json', JSON.stringify({ authored: Object.keys(guides).length, total: questions.length, missing }, null, 2));
if (process.argv.includes('--complete') && missing.length) throw new Error(`${missing.length} guides still need to be authored.`);
