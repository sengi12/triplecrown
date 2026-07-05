const path=require('path');
const fs=require('fs');
let pass=0,total=0;const chk=(c,l)=>{total++;if(c){pass++;console.log('  PASS:',l);}else console.log('  FAIL:',l);};

// Read the full HTML (CSS + JS) to verify structural fixes
const html=fs.readFileSync('/mnt/user-data/outputs/index.html','utf8');

console.log('=== Global horizontal-overflow lock ===');
chk(/html,body\{[^}]*overflow-x:hidden/.test(html),'html,body overflow-x:hidden');
chk(/\.content\{min-width:0;max-width:100%/.test(html),'.content constrained');
chk(html.includes('box-sizing:border-box'),'box-sizing border-box');

console.log('\n=== Additions tables scroll within container ===');
chk(html.includes('.add-table-scroll'),'add-table-scroll CSS present');
chk((html.match(/add-table-scroll/g)||[]).length>=4,'tables wrapped in scroll divs (CSS + 3 tables)');

console.log('\n=== Frozen team column (league-wide) ===');
chk(/\.sr-th-team\{[^}]*position:sticky;left:0/.test(html),'team header sticky-left');
chk(/\.sr-td-team\{[^}]*position:sticky;left:0/.test(html),'team cell sticky-left');
chk(html.includes('sr-td-team-inner'),'team cell inner flex span');
chk(/tr:hover \.sr-td-team\{background/.test(html),'frozen column opaque on hover');

console.log('\n=== render uses inner span (both league + SOS tables) ===');
chk((html.match(/sr-td-team-inner/g)||[]).length>=3,'inner span in CSS + league + SOS renders');

console.log('\nRESULT: '+pass+'/'+total+' '+(pass===total?'ALL PASS':'SOME FAILED'));
