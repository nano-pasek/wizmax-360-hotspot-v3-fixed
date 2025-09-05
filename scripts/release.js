#!/usr/bin/env node
import { execSync } from "child_process";
import fs from "fs";
import readline from "readline";

const mode = process.argv[2] || "patch";      // patch | minor | major | set
const target = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : undefined; // np. 1.2.3 gdy mode === "set"
const args = process.argv.slice(3);

// proste parsowanie flag: --desc "..." | --desc=...
function getFlag(name){
  const ix = args.findIndex(a => a === name || a.startsWith(name+"="));
  if(ix === -1) return undefined;
  const a = args[ix];
  if(a.includes('=')) return a.split('=')[1];
  const next = args[ix+1];
  return (next && !next.startsWith('--')) ? next : '';
}

const nonInteractive = args.includes('--non-interactive') || args.includes('--yes') || process.env.CI === 'true' || process.env.AUTO_RELEASE === '1';
const msgFromEnv = process.env.RELEASE_MSG || process.env.RELEASE_DESC;
const msgFromArg = getFlag('--desc');
const initialDesc = (msgFromArg ?? msgFromEnv ?? `auto release ${new Date().toISOString()}`).trim();

// pomocnicze – odpala komendę i pokazuje output w tym samym terminalu
function run(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

function safeCommit(desc) {
  try {
    run(`git add .`);
    // jeśli nie ma zmian, commit się wywali — złap i idź dalej
    run(`git commit -m "${desc}"`);
  } catch (_) {
    console.log("ℹ️  Brak nowych zmian do commita — lecimy dalej.");
  }
}

// --- Semver utils ---
function parseSemver(v){
  const m = (v || '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if(!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}
function semverToString(s){ return `${s.major}.${s.minor}.${s.patch}`; }
function cmp(a,b){ return (a.major-b.major) || (a.minor-b.minor) || (a.patch-b.patch); }
function bump(base, kind){
  const s = { ...base };
  if(kind === 'major'){ s.major++; s.minor = 0; s.patch = 0; }
  else if(kind === 'minor'){ s.minor++; s.patch = 0; }
  else /* patch */ { s.patch++; }
  return s;
}
function tagExists(v){
  try {
    execSync(`git rev-parse -q --verify "refs/tags/v${v}"`, { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

function computeNextVersion(){
  if(mode === 'set' && target){
    let desired = target;
    // jeśli tag istnieje, podbij o 1 patch żeby uniknąć kolizji
    while(tagExists(desired)){
      const s = parseSemver(desired) || {major:0,minor:0,patch:0};
      desired = semverToString(bump(s,'patch'));
    }
    return desired;
  }

  const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
  const pkgVer = parseSemver(pkg.version) || {major:0,minor:1,patch:0};

  let latestTag = null;
  try {
    const out = execSync('git tag --list "v*"', { encoding: 'utf8' }).trim();
    const tags = out ? out.split(/\r?\n/).filter(Boolean) : [];
    for(const t of tags){
      const s = parseSemver(t.replace(/^v/,''));
      if(s){ latestTag = latestTag ? (cmp(s, latestTag) > 0 ? s : latestTag) : s; }
    }
  } catch { /* brak tagów */ }

  const base = latestTag && cmp(latestTag, pkgVer) > 0 ? latestTag : pkgVer;
  let next = semverToString(bump(base, mode));
  while(tagExists(next)){
    // w skrajnych przypadkach — podbijaj dalej aż będzie wolny tag
    const s = parseSemver(next);
    next = semverToString(bump(s,'patch'));
  }
  return next;
}

function performRelease(desc){
  try {
    // 1) akceptacja + commit z opisem
    safeCommit(desc);

    // 2) Wyznacz stabilną, wolną wersję i utwórz tag
    const newVersion = computeNextVersion();
    run(`npm version ${newVersion} -m "v%s - ${desc}"`);

    // 3) Zaktualizuj src/version.ts
    const versionTs = `export const VERSION = '${newVersion}'\nexport const BUILD_DATE = new Date().toISOString().split('T')[0]\n`;
    fs.writeFileSync('src/version.ts', versionTs);
    safeCommit(`feat: update version.ts to ${newVersion}`);

    // 4) start dev
    run(`npm run dev`);
  } catch (err) {
    console.error("❌ Błąd:", err.message);
    process.exit(1);
  }
}

if(nonInteractive){
  performRelease(initialDesc || 'update');
} else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question("Podaj opis zmian (commit message): ", (descRaw) => {
    const desc = (descRaw || initialDesc || 'update').trim();
    performRelease(desc);
    rl.close();
  });
}
