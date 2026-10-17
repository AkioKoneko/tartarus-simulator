'use strict';
// Explain every display gate. Refresh means capture the game window, never click it.
function evaluate(s) {
  const a=s.advice, p=a && a.hints;
  const out=(code,text,refreshable=false,refresh=false)=>({code,text,refreshable,refresh});
  if(!s.native) return out('unavailable','Window geometry is unavailable.');
  if(!s.game) return out('game','Waiting for the game.');
  if(!s.on) return out('off','Overlay is hidden.');
  if(!s.agreed) return out('consent','Screen capture needs agreement.');
  if(s.riot || s.runOver) return out('run','Waiting for the prison board.');
  if(!a) return out('board','Waiting for a board picture.',true);
  if(a.toolsConfirm) return out('tools','Confirm your instruments in Board.');
  if(a.problems && a.problems.length) return out('problem','Fix the board before showing targets.');
  if(a.reading) return out('reading','Reading the new picture.');
  if(a.working) return out('working','Calculating the next action.');
  if(a.stale) return out('stale','Recheck the changed board.');
  if(!p || !p.valid) return out('no-target','No verified target for this screen.',true);
  if(!(p.capturedAt>s.invalidAt)) return out('changed','Waiting for the picture after your move.');
  const front=s.foreground && !s.minimized;
  if(s.now-p.capturedAt>30000) return out('expired',front?'Refreshing the board picture.':'Refresh the picture or return to the game.',true,front);
  if(!front) return out('foreground','Return to the game to see targets.');
  return out('visible','Active on the game window.');
}
module.exports={evaluate};
