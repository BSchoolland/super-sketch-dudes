# per-stage seconds from session.jsonl files, replaying forge.ts's stage rules
import json,sys,re
from datetime import datetime
ORDER=["drawing the animation","designing the moves","writing the fighter","balance testing","final checks and upload"]
def ts(s): return datetime.fromisoformat(s.replace("Z","+00:00")).timestamp()
for f in sys.argv[1:]:
  t0=None; last=None; marks={}; reached=-1
  for line in open(f):
    try: e=json.loads(line)
    except: continue
    t=e.get("timestamp")
    if t:
      t=ts(t); t0=t0 or t; last=t
    if e.get("type")!="assistant" or not t: continue
    for b in e.get("message",{}).get("content",[]):
      if b.get("type")!="tool_use": continue
      cmd=str((b.get("input") or {}).get("command") or (b.get("input") or {}).get("file_path") or "")
      run=lambda t: b["name"]=="Bash" and re.search(r"tsx\s+\S*tools/"+t+r"\b",cmd)
      st=("final checks and upload" if run("deploy") else "balance testing" if run("check")
          else "writing the fighter" if ".fighter.js" in cmd and b["name"]=="Write"
          else "designing the moves" if b["name"]=="Read" and "/cells/" in cmd
          else "drawing the animation" if run("sheet") else None)
      if st and ORDER.index(st)>reached: reached=ORDER.index(st); marks[st]=t-t0
  if not t0: continue
  print(f.split("/")[-2][:22].ljust(22), " ".join(f"{k[:6]}@{int(v)}" for k,v in marks.items()), f"end@{int(last-t0)}")
