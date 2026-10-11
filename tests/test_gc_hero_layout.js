// The Game Center hero, the player-card chips and the punt sentence — the three things a
// reader on a phone actually saw go wrong.
//
// The hero sits in a sidebar the reader can drag from 200px to 620px AND in a phone's
// full-width view, so its layout answers its own width through a container query rather than
// the viewport's. These assertions pin the CONTRACT (the markup and the rules that make the
// adaptation possible); test_game_center and test_games_sheet still pin what the hero says.
const fs=require('fs'), path=require('path');
const css=fs.readFileSync(path.join(__dirname,'..','src','css','32-game-center.css'),'utf8');
const pcss=fs.readFileSync(path.join(__dirname,'..','src','css','10-player-card.css'),'utf8');
const js=fs.readFileSync(path.join(__dirname,'..','src','js','32-game-center.js'),'utf8');
const built=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');

let P=0,F=0;
const chk=(c,l)=>{ if(c){P++;console.log('  PASS:',l);} else {F++;console.log('  FAIL:',l);} };

console.log('=== the hero answers its own width, not the viewport\'s ===');
chk(/\.gc-herowrap\{[^}]*container-type:inline-size/.test(css),
    'a size container wraps the hero, so a 200px sidebar and a 412px phone each get the right layout');
chk(/const hero=`<div class="gc-herowrap">/.test(js), 'the markup emits that wrapper');
chk(/@container \(max-width:430px\)/.test(css), 'and a container query, not a media query, switches the layout');
chk(built.includes('.gc-herowrap{'), 'the built file carries it');

console.log('=== a nickname can never sit on top of a score again ===');
// "Buccaneers" is one unbreakable word; the side is a grid item with min-width:0, so the
// column shrinks and the name used to spill straight across the score.
chk(/\.gc-team\{[^}]*overflow:hidden[^}]*text-overflow:ellipsis/.test(css),
    'the club name clips rather than overflowing its column');
chk(/\.gc-team\{[^}]*white-space:nowrap/.test(css), 'and never wraps mid-name');

console.log('=== each score stays beside its own club ===');
chk(/class="gc-score gc-score-a"/.test(js) && /class="gc-score gc-score-h"/.test(js),
    'the two scores are named, so the narrow layout can place them without :nth-of-type');
const narrow=(css.match(/@container \(max-width:430px\)\{[\s\S]*?\n\}/)||[''])[0];
chk(/grid-template-areas:"a sa \. sh h" "mid mid mid mid mid"/.test(narrow),
    'narrow: the situation takes a row of its own and the scores flank a gap, not each other');
chk(/\.gc-score-a\{grid-area:sa;\}/.test(narrow) && /\.gc-score-h\{grid-area:sh;\}/.test(narrow),
    'each score is placed on its own club\'s side');
chk(/minmax\(10px,1fr\)/.test(narrow),
    'the slack sits in the MIDDLE column — with it at the edges both scores slid together and read as one number');

console.log('=== the hero holds one height while a game is on ===');
chk(/\$\{\(spot\|\|game\.state==='in'\)\?`<div class="gc-spot">/.test(js),
    'the spot line stays in the DOM all game, empty between downs, so the hero does not resize when the down goes away');
chk(/align-items:center/.test(narrow),
    'the situation row centres rather than aligning to a baseline an empty element does not have');

console.log('=== and so does the block under it ===');
chk(/\.gc-last-text,\.gc-detail \.gc-last-text\{min-height:/.test(css),
    'the last play reserves two lines, so a short title and a long one leave the field in the same place');
chk(/\.gc-drive-sum,\.gc-detail \.gc-drive-sum\{min-height:/.test(css), 'the drive sentence too');
chk(!/-webkit-line-clamp/.test(css.slice(css.indexOf('.gc-last-text,'))),
    'a rare third line still grows rather than being clipped — the words matter more than the pixel');

console.log('=== the player card\'s active chip keeps its icon ===');
// --chip-on is WHITE. An icon pinned to #fff on it is invisible, and the NFL and College
// tabs are the wordmark ALONE — they rendered as blank white pills.
chk(/\.pcard-tab\.active \.tc-ico\{color:inherit;\}/.test(pcss),
    'the active tab\'s icon takes the chip\'s own ink instead of a hard-coded white');
chk(!/\.pcard-tab\.active \.tc-ico\{color:#fff/.test(pcss), 'the white-on-white rule is gone');
chk(built.includes('.pcard-tab.active .tc-ico{color:inherit;}'), 'and the built file carries the fix');

console.log(`\nRESULT: ${P}/${P+F} ` + (F?'SOME FAILED':'ALL PASS'));
process.exit(F?1:0);
