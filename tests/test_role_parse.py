import importlib.util, os, sys
bp=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","build_seed.py")
if not os.path.exists(bp): print("SKIP"); sys.exit(0)
spec=importlib.util.spec_from_file_location("build_seed",bp); bs=importlib.util.module_from_spec(spec); spec.loader.exec_module(bs)
cases=[("San Francisco 49ers assistant head coach (2024–2025)","SF","assistant head coach"),
("Miami Dolphins head coach (2022–2025)","MIA","head coach"),
("Chicago Bears offensive coordinator (2025)","CHI","offensive coordinator"),
("Dallas Cowboys interim head coach (2025)","DAL","interim head coach"),
("New York Jets co-offensive coordinator (2023)","NYJ","co-offensive coordinator"),
("Bengals quarterbacks coach (2020–2023)","CIN","quarterbacks coach")]
ok=True
for text,ec,er in cases:
    r=bs._parse_prev_position(text); good=(r["prev_code"]==ec and r["role"]==er); ok&=good
    print(("ok " if good else "MISS ")+repr(text)+" -> "+repr(r["role"]))
print("RESULT:", "PASS" if ok else "FAIL")
