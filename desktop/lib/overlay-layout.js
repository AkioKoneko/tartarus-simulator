'use strict';

const key = (collapsed) => collapsed ? 'overlayIcon' : 'overlay';
const position = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)
  ? {x:Math.round(p.x), y:Math.round(p.y)} : null;

function migrate(settings) {
  if (settings.overlayPositionsVersion >= 1) return;
  // The old shared coordinates describe whichever mode was last visible.
  const old = position(settings.overlay);
  if (old && !position(settings.overlayIcon)) settings.overlayIcon = {
    x:old.x + (settings.collapsed ? 0 : settings.overlayWidth - 56), y:old.y,
  };
  settings.overlayPositionsVersion = 1;
}

function remember(settings, bounds) {
  const at = position(bounds);
  if (at) settings[key(settings.collapsed)] = at;
}

function visible(bounds, area) {
  const across=Math.min(bounds.x+bounds.width,area.x+area.width)-Math.max(bounds.x,area.x);
  const down=Math.min(bounds.y+bounds.height,area.y+area.height)-Math.max(bounds.y,area.y);
  return across>=Math.min(32,bounds.width/2) && down>=Math.min(32,bounds.height/2);
}

function bounds(settings, area, cardHeight, onScreen) {
  const width = settings.collapsed ? 56 : settings.overlayWidth;
  const saved = position(settings[key(settings.collapsed)]);
  const at = saved && onScreen({...saved,width,height:settings.collapsed?56:cardHeight}) ? saved : {
    x:Math.round(area.x + area.width - width - 24),
    y:Math.round(area.y + Math.min(140, area.height / 8)),
  };
  return {...at, width, height:settings.collapsed ? 56 : cardHeight};
}

module.exports = {key, migrate, remember, bounds, visible};
