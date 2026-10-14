import { describe, it, expect, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, truncateSync, writeFileSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderAntigravityAgent, materializeAntigravityAgents, cleanupAntigravityAgents } from '../src/antigravity-agent-config';
import type { AgentDef } from '../src/custom-agents';
const def = (extra: Partial<AgentDef> = {}): AgentDef => ({name:'probe',description:'native\nquote "probe"',instructions:'Remember CHILD_NONCE.',tools:null,model:null,mentions:[],...extra});
const roots: string[] = [];
const fixture = () => { const root = mkdtempSync(join(tmpdir(),'hnm-ag-agents-')); roots.push(root); execFileSync('git',['init','-q',root]); return root; };
const markdown = (cwd: string) => readdirSync(join(cwd,'.agents/agents')).filter(n=>n.endsWith('.md'));
afterEach(()=>{vi.unstubAllEnvs();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
describe('native Antigravity agent rendering',()=>{
  it('uses verified frontmatter, inline child context and inherit, without unsupported fields',()=>{
    const text = renderAntigravityAgent(def({kind:'phase',context:'context nonce'}),[]);
    expect(text).toContain('name: "probe"\ndescription: "native\\nquote \\"probe\\""\nmodel: "inherit"\nmainAgent: false\nsubagent: true');
    expect(text).toContain('=== KONTEKS ===\ncontext nonce');
    for(const field of ['tools:','effort:','permissionMode:','sandbox_mode:','maxTurns:'])expect(text).not.toContain(field);
    expect(renderAntigravityAgent(def({model:'flash'}),[])).toContain('model: "flash"');
    expect(renderAntigravityAgent(def({model:'pro'}),[])).toContain('model: "pro"');
    expect(renderAntigravityAgent(def({maxTurns:4}),[])).toContain('instruksional di Antigravity');
  });
  it.each([{name:'../operator'},{model:'gemini-3.8-flash-high'},{effort:'high'},{tools:['Read']},{workspacePolicy:'read-only'},{workspacePolicy:'isolated-worktree'}] as Partial<AgentDef>[])('rejects unsupported native contract %j',extra=>expect(()=>renderAntigravityAgent(def(extra),[])).toThrow());
  it('uses native invoke and same child relay names for mentions and parent delegation',()=>{
    const a=def({mentions:['peer']}), b=def({name:'peer'});
    const text=renderAntigravityAgent(a,[a,b]);
    expect(text).toContain('invoke_subagent'); expect(text).not.toContain('tool Task');
  });
});
describe('session registry ownership',()=>{
  it('materializes private files and excludes Git, cleans by persisted manifest after restart',()=>{
    const cwd=fixture(); const m=materializeAntigravityAgents({cwd,sessionId:'session-one',defs:[def()]});
    expect(m.names).toEqual(['probe']);
    const directory=join(cwd,'.agents/agents'); expect(statSync(directory).mode&0o777).toBe(0o700);
    expect(statSync(join(directory,markdown(cwd)[0]!)).mode&0o777).toBe(0o600);
    expect(statSync(join(directory,readdirSync(directory).find(n=>n.endsWith('.json'))!)).mode&0o777).toBe(0o600);
    expect(execFileSync('git',['status','--porcelain'],{cwd,encoding:'utf8'})).toBe('');
    cleanupAntigravityAgents({cwd,sessionId:'session-one'});
    expect(existsSync(directory)&&markdown(cwd).length>0).toBe(false);
    expect(readFileSync(join(cwd,'.git/info/exclude'),'utf8')).not.toContain('hanoman:antigravity-agents');
    m.cleanup();
  });
  it('preserves operator named definitions and files edited after materialization',()=>{
    const cwd=fixture(),dir=join(cwd,'.agents/agents'); mkdirSync(dir,{recursive:true});
    const operator='---\nname: probe # operator definition\nmodel: inherit\n---\noperator'; writeFileSync(join(dir,'other-name.md'),operator);
    const m=materializeAntigravityAgents({cwd,sessionId:'s',defs:[def(),def({name:'other'})]});
    expect(m.names).toEqual(['other']);expect(m.warnings[0]?.reason).toMatch(/collision/);
    const own=markdown(cwd).find(n=>n!=='other-name.md')!; writeFileSync(join(dir,own),'operator edited');m.cleanup();
    expect(readFileSync(join(dir,'other-name.md'),'utf8')).toBe(operator);expect(readFileSync(join(dir,own),'utf8')).toBe('operator edited');
  });
  it('rolls phase materialization back all-or-nothing, isolates failed custom definition',()=>{
    const cwd=fixture(); const m=materializeAntigravityAgents({cwd,sessionId:'s',defs:[def({kind:'phase'}),def({kind:'phase',name:'bad',model:'slug'})]});
    expect(m.names).toEqual([]); expect(m.warnings.some(w=>w.agentName==='bad')).toBe(true); expect(markdown(cwd)).toEqual([]);
    m.cleanup();
    const c=materializeAntigravityAgents({cwd,sessionId:'s2',defs:[def(),def({name:'bad',workspacePolicy:'read-only'})]});
    expect(c.names).toEqual(['probe']);expect(c.warnings).toHaveLength(1);c.cleanup();
  });
  it('removes partial writes when an exclusive file write fails',()=>{
    const cwd=fixture();let writes=0;
    const m=materializeAntigravityAgents({cwd,sessionId:'s',defs:[def({kind:'phase'}),def({name:'second',kind:'phase'})],writeFile:(path,content)=>{writeFileSync(path,++writes===2?content.slice(0,12):content,{mode:0o600});if(writes===2)throw new Error('disk failure');}});
    expect(m.names).toEqual([]); expect(markdown(cwd)).toEqual([]);m.cleanup();
  });
  it('omits failed custom names from successful child instructions',()=>{
    const cwd=fixture();const a=def({mentions:['bad']}),b=def({name:'bad',workspacePolicy:'read-only'});
    const m=materializeAntigravityAgents({cwd,sessionId:'s',defs:[a,b]});
    expect(readFileSync(join(cwd,'.agents/agents',markdown(cwd)[0]!), 'utf8')).not.toContain('@bad');m.cleanup();
  });
  it.each(['edit', 'symlink'] as const)('preserves an operator %s between initial write and live roster rewrite', (replacement) => {
    const cwd = fixture(), outside = join(fixture(), 'operator-sentinel');
    writeFileSync(outside, 'outside operator sentinel');
    let first = '';
    const m = materializeAntigravityAgents({ cwd, sessionId: 's', defs: [def(), def({ name: 'second', mentions: ['probe'] })],
      writeFile: (path, content) => {
        writeFileSync(path, content);
        if (!first) first = path;
        else if (replacement === 'symlink') { unlinkSync(first); symlinkSync(outside, first); }
        else writeFileSync(first, 'operator edited content');
      },
    });
    expect(readFileSync(outside, 'utf8')).toBe('outside operator sentinel');
    expect(readFileSync(first, 'utf8')).toBe(replacement === 'symlink' ? 'outside operator sentinel' : 'operator edited content');
    expect(m.names).toEqual(['second']);
    expect(m.warnings).toContainEqual({ agentName: 'probe', reason: 'native registry ownership changed during roster preparation' });
    const second = markdown(cwd).find(n => n.endsWith('-second.md'))!;
    expect(readFileSync(join(cwd, '.agents/agents', second), 'utf8')).not.toContain('@probe');
    m.cleanup();
    expect(readFileSync(first, 'utf8')).toBe(replacement === 'symlink' ? 'outside operator sentinel' : 'operator edited content');
    expect(readFileSync(outside, 'utf8')).toBe('outside operator sentinel');
  });
  it('rolls back a phase roster if ownership changes before final rendering', () => {
    const cwd = fixture(); let first = '';
    const m = materializeAntigravityAgents({ cwd, sessionId: 's', defs: [def({ kind: 'phase' }), def({ name: 'second', kind: 'phase' })],
      writeFile: (path, content) => { writeFileSync(path, content); if (!first) first = path; else writeFileSync(first, 'operator phase edit'); },
    });
    expect(m.names).toEqual([]); expect(m.liveDefs).toEqual([]);
    expect(m.warnings).toContainEqual({ agentName: 'probe', reason: 'native registry ownership changed during roster preparation' });
    expect(readFileSync(first, 'utf8')).toBe('operator phase edit');
    expect(markdown(cwd)).toEqual([first.split('/').at(-1)]);
    m.cleanup(); expect(readFileSync(first, 'utf8')).toBe('operator phase edit');
  });
  it('preserves another session in the same cwd by rejecting its exact native names',()=>{
    const cwd=fixture(),a=materializeAntigravityAgents({cwd,sessionId:'a',defs:[def()]});
    const b=materializeAntigravityAgents({cwd,sessionId:'b',defs:[def()]});
    expect(a.names).toEqual(['probe']); expect(b.names).toEqual([]); expect(b.warnings[0]?.reason).toMatch(/collision/);
    b.cleanup(); expect(markdown(cwd)).toHaveLength(1); a.cleanup();
  });
  it('rejects unsafe registry directories and invalid session ids',()=>{
    const cwd=fixture(); const target=mkdtempSync(join(tmpdir(),'hnm-ag-target-'));roots.push(target);symlinkSync(target,join(cwd,'.agents'));
    expect(()=>materializeAntigravityAgents({cwd,sessionId:'s',defs:[def()]})).toThrow();expect(()=>materializeAntigravityAgents({cwd,sessionId:'../x',defs:[def()]})).toThrow();expect(readdirSync(target)).toEqual([]);
  });
  it('keeps independent common-dir exclude pairs for two worktrees with the same native names',()=>{
    const repo=fixture();execFileSync('git',['-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','fixture'],{cwd:repo});
    const second=join(repo,'second'); execFileSync('git',['worktree','add','--detach',second,'HEAD'],{cwd:repo,stdio:'ignore'});
    const a=materializeAntigravityAgents({cwd:repo,sessionId:'a',defs:[def()]}),b=materializeAntigravityAgents({cwd:second,sessionId:'b',defs:[def()]});
    expect(a.names).toEqual(b.names);a.cleanup();expect(execFileSync('git',['status','--porcelain'],{cwd:second,encoding:'utf8'})).toBe('');b.cleanup();
  });
});


it("git metadata child excludes Antigravity credentials while preserving unrelated env", () => {
  const cwd = fixture();
  const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const fakeDir = join(cwd, "fake-bin"); mkdirSync(fakeDir);
  const result = join(cwd, "git-env.json");
  writeFileSync(join(fakeDir, "git"), `#!${process.execPath}
const fs = require('node:fs'); const cp = require('node:child_process');
fs.writeFileSync(${JSON.stringify(result)}, JSON.stringify({ keyPresent: Object.hasOwn(process.env,'GEMINI_API_KEY'), basePresent: Object.hasOwn(process.env,'GOOGLE_GEMINI_BASE_URL'), projectKept: process.env.GOOGLE_CLOUD_PROJECT === 'fixture-project' }));
const out = cp.spawnSync(${JSON.stringify(realGit)}, process.argv.slice(2), {stdio:'inherit'}); process.exit(out.status ?? 1);
`, { mode: 0o700 });
  vi.stubEnv("PATH", `${fakeDir}:${process.env.PATH}`); vi.stubEnv("GEMINI_API_KEY", "fixture-key"); vi.stubEnv("GOOGLE_GEMINI_BASE_URL", "https://fixture.invalid"); vi.stubEnv("GOOGLE_CLOUD_PROJECT", "fixture-project");
  const own = materializeAntigravityAgents({ cwd, sessionId: "env-probe", defs: [def()] });
  expect(JSON.parse(readFileSync(result, "utf8"))).toEqual({ keyPresent: false, basePresent: false, projectKept: true });
  own.cleanup();
});

describe("bounded operator registry inspection", () => {
  it("reads only frontmatter of a huge operator definition while preserving its body", () => {
    const cwd = fixture(), dir = join(cwd, ".agents/agents"); mkdirSync(dir, { recursive: true });
    const file = join(dir, "operator.md"); writeFileSync(file, "---\nname: probe\n---\n"); truncateSync(file, 128 * 1024 * 1024);
    const m = materializeAntigravityAgents({ cwd, sessionId: "large", defs: [def()] });
    expect(m.names).toEqual([]); expect(m.warnings[0]?.reason).toContain("collision");
    expect(statSync(file).size).toBe(128 * 1024 * 1024); m.cleanup();
  });
  it("rejects excessive operator definitions before materializing a partial roster", () => {
    const cwd = fixture(), dir = join(cwd, ".agents/agents"); mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 257; i++) writeFileSync(join(dir, `operator-${i}.md`), "---\nname: operator\n---\n");
    expect(() => materializeAntigravityAgents({ cwd, sessionId: "many", defs: [def()] })).toThrow("native registry inspection limit");
    expect(readdirSync(dir)).toHaveLength(257);
  });
  it("rejects frontmatter beyond the bounded prefix rather than overlooking a collision", () => {
    const cwd = fixture(), dir = join(cwd, ".agents/agents"); mkdirSync(dir, { recursive: true });
    const file = join(dir, "operator.md"), contents = "---\n" + "description: ".padEnd(20000, "x") + "\nname: probe\n---\n"; writeFileSync(file, contents);
    expect(() => materializeAntigravityAgents({ cwd, sessionId: "long", defs: [def()] })).toThrow("native registry frontmatter inspection limit");
    expect(readFileSync(file, "utf8")).toBe(contents);
  });
});
