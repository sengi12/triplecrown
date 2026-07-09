import importlib.util, os, sys
here=os.path.dirname(os.path.abspath(__file__))
bp=os.path.join(here,"..","build_seed.py")
fx=os.path.join(here,"spotrac_cin_fixture.html")
if not os.path.exists(bp) or not os.path.exists(fx):
    print("SKIP: missing build_seed or fixture"); sys.exit(0)
spec=importlib.util.spec_from_file_location("build_seed",bp); bs=importlib.util.module_from_spec(spec); spec.loader.exec_module(bs)
import re
html=open(fx).read()
fa=bs._parse_signing_table(bs._spot_table_in_pane(html,bs._spot_find_tab_id(html,"FREE AGENTS")),"free_agent")
dr=bs._parse_signing_table(bs._spot_table_in_pane(html,bs._spot_find_tab_id(html,"DRAFT")),"draft")
tm=re.search(r'accordion-traded',html); ts=html.find('<table',tm.start()); te=html.find('</table>',ts)
tr=bs._parse_traded_table(html[ts:te])
ok=True
ok &= bs._spot_find_tab_id(html,"FREE AGENTS")=="tab1"
ok &= bs._spot_find_tab_id(html,"DRAFT")=="tab13"
ok &= fa[0]['player']=='Boye Mafe' and abs((fa[0]['value_m'] or 0)-60.0)<0.01 and fa[0]['years']==3
ok &= any(r['player']=='Cashius Howell' for r in dr)
law=[r for r in tr if r['player']=='Dexter Lawrence']
ok &= len(law)==1 and abs((law[0]['cap_m'] or 0)-20.0)<0.01 and 'Traded to Cincinnati' in law[0]['detail']
ok &= bs._spot_money_to_millions('$60,000,000')==60.0
ok &= bs.SPOTRAC_TEAM['JAX']=='jax'  # our JAX → spotrac jac
print(f"FA={len(fa)} DR={len(dr)} TR={len(tr)}; Mafe/Howell/Lawrence validated")

# Free Agents Lost
lm=re.search(r'accordion-falost',html); lts=html.find('<table',lm.start()); lte=html.find('</table>',lts)
losses=bs._parse_losses_table(html[lts:lte])
hen=[r for r in losses if r['player']=='Trey Hendrickson']
ok &= len(hen)==1 and hen[0]['to_team']=='BAL' and abs((hen[0]['value_m'] or 0)-112.0)<0.01
oss=[r for r in losses if r['player']=='Joseph Ossai']
ok &= len(oss)==1 and oss[0]['to_team']=='NYJ'
ok &= losses[0]['player']=='Trey Hendrickson'   # sorted by value
ok &= bs.SPOTRAC_TEAM['JAX']=='jax'   # JAX slug fix
print(f"Losses={len(losses)}; Hendrickson→BAL, Ossai→NYJ validated; JAX slug ok")

print("RESULT:", "PASS" if ok else "FAIL")
