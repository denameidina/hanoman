import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderAntigravityAgent, materializeAntigravityAgents, cleanupAntigravityAgents } from '../src/antigravity-agent-config';
import type { AgentDef } from '../src/custom-agents';
const def = (extra: Partial<AgentDef> = {}): AgentDef => ({name:'probe',description:'native\nquote "probe"',instructions:'Remember CHILD_NONCE.',tools:null,model:null,mentions:[],...extra});
const roots: string[] = [];
const fixture = () => { const root = mkdtempSync(join(tmpdir(),'hnm-ag-agents-')); roots.push(root); execFileSync('git',['init','-q',root]); return root; };
const markdown = (cwd: string) => readdirSync(join(cwd,'.agents/agents')).filter(n=>n.endsWith('.md'));
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
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
