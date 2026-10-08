# tools/verify.py
import os,re,json,sys
os.chdir('/mnt/user-data/outputs/oau-life-backend')
files=[os.path.relpath(os.path.join(r,f),'.') for r,d,fs in os.walk('.') if 'node_modules' not in r for f in fs]
fail=[]
def bad(m): fail.append(m)
pkg=json.load(open('package.json')); deps=set(pkg['dependencies'])|set(pkg.get('devDependencies',{}))
BUILTIN={'fs','path','crypto','child_process','url','os'}
# 1. first line is the path comment
fmt={'.js':'// %s','.mjs':'// %s','.prisma':'// %s','.css':'/* %s */','.sql':'-- %s','.md':'<!-- %s -->','.py':'# %s','.html':'<!-- %s -->'}
commented=0
for f in files:
    if f in('package.json','jsconfig.json'): continue
    ext=os.path.splitext(f)[1]; exp=('# %s' if os.path.basename(f)=='.env.example' else fmt.get(ext,'')) % f
    first=open(f,encoding='utf-8').read().split('\n')[0]
    if first!=exp: bad(f'first line wrong in {f}: {first!r}')
    else: commented+=1
print(f"1. first-line path comments correct: {commented} files")
# 2. "use client" must come before any import
uc=0
for f in files:
    if f.endswith('.js') and f.startswith('app/') and not f.endswith('route.js') and 'layout' not in f:
        code=[l for l in open(f).read().split('\n') if l.strip() and not l.strip().startswith('//')]
        if code[0].strip()!='"use client";': bad(f'"use client" is not the first statement in {f}: {code[0][:40]}')
        else: uc+=1
print(f"2. client pages with \"use client\" first: {uc}")
# 3. imports resolve
js=[f for f in files if f.endswith(('.js','.mjs'))]
def resolve(base,spec):
    p=spec[2:] if spec.startswith('@/') else os.path.normpath(os.path.join(os.path.dirname(base),spec))
    for c in (p,p+'.js',p+'.mjs',p+'/index.js'):
        if os.path.isfile(c): return c
    return None
exports={}
def exps(path):
    if path in exports: return exports[path]
    s=open(path).read(); e=set(re.findall(r'export\s+(?:async\s+)?(?:function|const|class|let)\s+(\w+)',s))
    for line in re.findall(r'^export\s+const\s+([^\n;]*);',s,re.M): e|=set(re.findall(r'(?:^|,)\s*(\w+)\s*=',line))
    for m in re.findall(r'export\s*\{([^}]*)\}',s): e|={x.strip().split(' as ')[-1] for x in m.split(',') if x.strip()}
    if re.search(r'export\s+default',s): e.add('default')
    exports[path]=e; return e
checked=0
for f in js:
    s=open(f).read()
    for names,spec in re.findall(r'import\s+(?:([\w*{}\s,]+?)\s+from\s+)?["\']([^"\']+)["\']',s):
        if spec.startswith(('.','@/')):
            t=resolve(f,spec)
            if not t: bad(f'unresolved import "{spec}" in {f}'); continue
            checked+=1
            m=re.search(r'\{([^}]*)\}',names or '')
            if m:
                for n in [x.strip().split(' as ')[0] for x in m.group(1).split(',') if x.strip()]:
                    if n not in exps(t): bad(f'{f} imports "{n}" but {t} does not export it')
        else:
            root=spec.split('/')[0] if not spec.startswith('@') else '/'.join(spec.split('/')[:2])
            if spec.startswith('node:') or root in BUILTIN: continue
            if root not in deps and root!='next': bad(f'package "{root}" used in {f} is not in package.json')
print(f"3. relative/alias imports resolved and named exports found: {checked}")
# 4. fetch() calls in pages hit real routes
routes={'/'+os.path.dirname(f)[len('app/'):] for f in files if f.endswith('route.js')}
calls=set()
for f in files:
    if f.startswith(('app/','lib/client.js')) and f.endswith('.js') and not f.endswith('route.js'):
        calls|=set(re.findall(r'["`](/api/[\w/\-]+)',open(f).read()))
missing=[c for c in calls if c not in routes]
print(f"4. API paths called from the browser: {len(calls)}; routes that exist: {len(routes)}; missing: {missing or 'none'}")
for m in missing: bad(f'browser calls {m} but no route file exists')
# 5. prisma models used in code exist
schema=open('prisma/schema.prisma').read(); models={m[0].lower()+m[1:] for m in re.findall(r'^model\s+(\w+)',schema,re.M)}
used=set()
for f in js:
    if f.startswith('tests/'): continue
    used|=set(re.findall(r'\b(?:db|tx)\.([a-z]\w+)\.(?:findUnique|findFirst|findMany|create|createMany|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy)\b',open(f).read()))
unk=sorted(u for u in used if u not in models)
print(f"5. database models used in code: {len(used)}; unknown to schema: {unk or 'none'}")
for u in unk: bad(f'code uses model "{u}" which is not in schema.prisma')
# 6. route files only export what Next allows
ok={'GET','POST','PUT','PATCH','DELETE','dynamic'}
for f in files:
    if f.endswith('route.js'):
        ex=set(re.findall(r'export\s+(?:async\s+function|const)\s+(\w+)',open(f).read()))
        if ex-ok: bad(f'{f} exports names Next does not allow: {ex-ok}')
        if 'dynamic' not in ex: bad(f'{f} is missing the dynamic export')
print("6. route files export only allowed names and are dynamic")
# 7. no leftover sandbox paths
for f in files:
    if '/mnt/' in open(f,errors='ignore').read() and not f.endswith('.md') and not f.startswith('tools/'): bad(f'sandbox path left in {f}')
print("7. no sandbox paths left in code")
print("\nPROBLEMS:",fail if fail else "none")
sys.exit(1 if fail else 0)
