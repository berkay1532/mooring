// Bitt, the Mooring mascot — parametric SVG generator.
// bitt(opts) returns the inner SVG markup; wrap it in <svg viewBox="…">DEFS + …</svg>.
// Options: ink, eye, w, h, cap (mushroom|captain|peaked|fisherman|rope-band|beanie|mushroom-band|dixie),
// rope (coil|arm|throw|bow|shoulder|none), arms (true|'crossed'), mouth (smile|grin|worry|flat|o|sleep),
// eyes (open|wink|closed|x|half|star), brows (none|angry|sad), extra (none|card|rope-end), cheeks, blush, tilt.
// The exported SVGs in this folder were produced from these options; see sheet.html for a gallery.
// ---------- parametric Bitt ----------
// opts: ink (body colour), eye (eye colour), w (body width), h (body height), cap: 'mushroom'|'peaked'|'none', band (cap band colour)
// rope: 'coil'|'arm'|'bow'|'shoulder'|'none', arms: bool, mouth: 'smile'|'worry'|'flat'|'grin'|'o'|'sleep', eyes: 'open'|'wink'|'closed'|'x'|'half'|'star', brows: 'none'|'angry'|'sad'
// extra: 'card'|'rope-end'|'none'
function bitt(o) {
  o = Object.assign({ ink:'#f2eee4', eye:'#0a1522', w:64, h:150, cap:'mushroom', band:null, rope:'coil', arms:false, mouth:'smile', eyes:'open', brows:'none', extra:'none', cheeks:true, blush:'rgba(242,180,74,.45)', tilt:0 }, o);
  const w = o.w, h = o.h, r = w/2, hw = w/2;
  const faceY = -h + 32;        // eye line
  const cw = w + 28;            // cap width
  let s = `<g transform="rotate(${o.tilt})">`;
  // rope behind (shoulder)
  if (o.rope === 'shoulder') s += `<path d="M${-hw-6} ${-h+60} q ${-18} 40 ${-8} 80 q 10 36 ${hw+24} 30" fill="none" stroke="#f2b44a" stroke-width="9" stroke-linecap="round"/>`;
  // body
  s += `<rect x="${-hw}" y="${-h}" width="${w}" height="${h}" rx="${r}" fill="${o.ink}"/>`;
  s += `<rect x="${-hw}" y="${-h}" width="${w}" height="${h}" rx="${r}" fill="url(#shade)"/>`;
  // rope variants
  if (o.rope === 'coil') for (let i = 0; i < 3; i++) s += `<path d="M${-hw+2} ${-h+78+i*14} q ${hw-2} 10 ${w-4} 0" fill="none" stroke="#f2b44a" stroke-width="9" stroke-linecap="round"/>`;
  if (o.rope === 'bow') s += `<path d="M${-hw+2} ${-h+86} q ${hw-2} 10 ${w-4} 0" fill="none" stroke="#f2b44a" stroke-width="9" stroke-linecap="round"/><path d="M-2 ${-h+92} c -26 -22 -34 6 -6 8 c 28 -2 20 -30 -6 -8 Z" fill="none" stroke="#f2b44a" stroke-width="7" stroke-linejoin="round"/>`;
  if (o.rope === 'arm') s += `<path d="M${hw-4} ${-h+90} q 44 4 54 -40 q 6 -30 -14 -38" fill="none" stroke="#f2b44a" stroke-width="9" stroke-linecap="round"/><ellipse cx="${hw+44}" cy="${-h+8}" rx="16" ry="10" fill="none" stroke="#f2b44a" stroke-width="8" transform="rotate(-30 ${hw+44} ${-h+8})"/><path d="M${-hw+2} ${-h+78} q ${hw-2} 10 ${w-4} 0" fill="none" stroke="#f2b44a" stroke-width="9" stroke-linecap="round"/>`;
  if (o.rope === 'throw') s += `<path d="M${hw-4} ${-h+88} q 50 -10 62 -70 q 8 -40 -4 -60" fill="none" stroke="#f2b44a" stroke-width="9" stroke-linecap="round"/><ellipse cx="${hw+62}" cy="${-h-46}" rx="22" ry="13" fill="none" stroke="#f2b44a" stroke-width="8" transform="rotate(-20 ${hw+62} ${-h-46})"/><path d="M${-hw+2} ${-h+78} q ${hw-2} 10 ${w-4} 0" fill="none" stroke="#f2b44a" stroke-width="9" stroke-linecap="round"/>`;
  if (o.rope === 'shoulder') s += `<path d="M${-hw-2} ${-h+60} q 20 14 ${w+4} 10" fill="none" stroke="#f2b44a" stroke-width="9" stroke-linecap="round"/>`;
  // little arms
  if (o.arms === 'crossed') s += `<path d="M${-hw+4} ${-h+100} q 30 22 ${w-8} 10" fill="none" stroke="${o.ink}" stroke-width="11" stroke-linecap="round"/><path d="M${hw-4} ${-h+100} q -30 22 ${-w+8} 10" fill="none" stroke="${o.ink}" stroke-width="11" stroke-linecap="round"/><path d="M${-hw+4} ${-h+100} q 30 22 ${w-8} 10 M${hw-4} ${-h+100} q -30 22 ${-w+8} 10" fill="none" stroke="rgba(10,21,34,.25)" stroke-width="1.5"/>`;
  else if (o.arms) s += `<path d="M${-hw} ${-h+96} q -22 6 -26 28" fill="none" stroke="${o.ink}" stroke-width="10" stroke-linecap="round"/><path d="M${hw} ${-h+96} q 22 6 26 28" fill="none" stroke="${o.ink}" stroke-width="10" stroke-linecap="round"/>`;
  // extras
  if (o.extra === 'card') s += `<g transform="translate(${hw-6},${-h+70}) rotate(-12)"><rect x="0" y="0" width="58" height="36" rx="5" fill="#16283f" stroke="#2f4a66" stroke-width="1.5"/><rect x="6" y="6" width="14" height="8" rx="2" fill="#f2b44a"/><rect x="6" y="22" width="40" height="3" rx="1.5" fill="rgba(127,184,168,.8)"/><rect x="6" y="28" width="26" height="3" rx="1.5" fill="rgba(242,238,228,.35)"/></g><path d="M${hw-4} ${-h+92} q 20 -4 28 -14" fill="none" stroke="#f2b44a" stroke-width="8" stroke-linecap="round"/>`;
  if (o.extra === 'rope-end') s += `<path d="M${hw-2} ${-h+100} q 30 10 40 40 q 6 20 -8 30" fill="none" stroke="#f2b44a" stroke-width="9" stroke-linecap="round"/>`;
  // cap
  if (o.cap !== 'none' && o.cap !== 'mushroom-band') s += `<rect x="${-cw/2}" y="${-h-18}" width="${cw}" height="30" rx="15" fill="${o.ink}"/><rect x="${-cw/2}" y="${-h-18}" width="${cw}" height="12" rx="6" fill="rgba(255,255,255,.3)"/>`;
  const HT = -h - 18; // top of the mushroom head: hats sit here
  if (o.cap === 'peaked') s += `<g transform="translate(0,${-18}) scale(.84)"><path d="M${-cw/2} ${-h-6} q 0 -30 ${cw/2} -30 q ${cw/2} 0 ${cw/2} 30 Z" fill="#16283f"/><rect x="${-cw/2}" y="${-h-10}" width="${cw}" height="12" rx="4" fill="#16283f"/><rect x="${-cw/2+2}" y="${-h-10}" width="${cw-4}" height="4" fill="#f2b44a"/><path d="M${-cw/2-10} ${-h+2} q ${cw/2+10} 10 ${cw+20} 0 l -6 -6 q ${-cw/2-4} -6 ${-cw-8} 0 Z" fill="#0d1b2e"/><g transform="translate(0,${-h-26}) scale(.22)"><rect x="-36" y="-24" width="20" height="62" rx="10" fill="#f2eee4"/><rect x="16" y="-24" width="20" height="62" rx="10" fill="#f2eee4"/><path d="M-22 -14 L 0 30 L 22 -14" stroke="#f2b44a" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g></g>`;
  if (o.cap === 'beanie') s += `<g transform="translate(0,-16)"><path d="M${-hw-6} ${-h+6} q 0 -40 ${hw+6} -40 q ${hw+6} 0 ${hw+6} 40 Z" fill="#7fb8a8"/><rect x="${-hw-8}" y="${-h-2}" width="${w+16}" height="14" rx="6" fill="#6aa595"/><circle cx="0" cy="${-h-36}" r="7" fill="#f2b44a"/></g>`;
  if (o.cap === 'captain') { const B = HT - 2; const bw = cw - 18; const W = bw + 12; // compact cartoon captain hat
    s += `<g id="captain">`
      // crown: a soft dome, barely wider than the head, slight forward tilt
      + `<path d="M${-W/2} ${B-12} C ${-W/2-2} ${B-50}, ${W/2+2} ${B-50}, ${W/2} ${B-12} Z" fill="#f7f3ea"/>`
      + `<path d="M${-W/2+10} ${B-24} Q 0 ${B-42} ${W/2-10} ${B-24}" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="3" stroke-linecap="round"/>`
      // band
      + `<rect x="${-bw/2}" y="${B-14}" width="${bw}" height="20" rx="6" fill="#16283f"/>`
      // one amber cord across the band
      + `<path d="M${-bw/2+8} ${B+1} Q 0 ${B-7} ${bw/2-8} ${B+1}" fill="none" stroke="#f2b44a" stroke-width="3" stroke-linecap="round"/>`
      // badge: amber ring, navy centre, the mark
      + `<circle cx="0" cy="${B-5}" r="9" fill="#0a1522" stroke="#f2b44a" stroke-width="2"/>`
      + `<g transform="translate(0,${B-5}) scale(.14)"><rect x="-36" y="-30" width="20" height="62" rx="10" fill="#f2eee4"/><rect x="16" y="-30" width="20" height="62" rx="10" fill="#f2eee4"/><path d="M-22 -20 L 0 24 L 22 -20" stroke="#f2b44a" stroke-width="12" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`
      // visor: short rounded wedge
      + `<path d="M${-bw/2-4} ${B+4} Q 0 ${B+28} ${bw/2+4} ${B+4} Q 0 ${B+10} ${-bw/2-4} ${B+4} Z" fill="#0a1522"/>`
      + `<path d="M${-bw/2+2} ${B+8} Q 0 ${B+22} ${bw/2-2} ${B+8}" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="2"/>`
      + `</g>`; }
  if (o.cap === 'fisherman') { const W = cw + 16, B = -h - 4; s += `<path d="M${-W/2} ${B} q 0 -40 ${W/2} -40 q ${W/2} 0 ${W/2} 40 Z" fill="#16283f"/><rect x="${-W/2}" y="${B-4}" width="${W}" height="16" rx="4" fill="#0d1b2e"/><path d="M${-W/2+8} ${B+3} q ${W/2-8} 8 ${W-16} 0" fill="none" stroke="#f2b44a" stroke-width="4" stroke-dasharray="6 3" stroke-linecap="round"/><path d="M${-W/2-8} ${B+12} q ${W/2+8} 10 ${W+16} 0 l -6 -6 q ${-W/2-2} -5 ${-W-4} 0 Z" fill="#0a1522"/>`; }
  if (o.cap === 'rope-band') s += `<path d="M${-cw/2} ${-h-6} q 0 -30 ${cw/2} -30 q ${cw/2} 0 ${cw/2} 30 Z" fill="#16283f"/><rect x="${-cw/2}" y="${-h-10}" width="${cw}" height="12" rx="4" fill="#16283f"/><path d="M${-cw/2+2} ${-h-5} q ${cw/4} 7 ${cw/2-2} 0 q ${cw/4} -7 ${cw/2-2} 0" fill="none" stroke="#f2b44a" stroke-width="5" stroke-linecap="round"/><path d="M${-cw/2-10} ${-h+2} q ${cw/2+10} 10 ${cw+20} 0 l -6 -6 q ${-cw/2-4} -6 ${-cw-8} 0 Z" fill="#0d1b2e"/><g transform="translate(0,${-h-26}) scale(.2)"><rect x="-36" y="-24" width="20" height="62" rx="10" fill="#f2eee4"/><rect x="16" y="-24" width="20" height="62" rx="10" fill="#f2eee4"/><path d="M-22 -14 L 0 30 L 22 -14" stroke="#f2b44a" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`;
  if (o.cap === 'dixie') s += `<path d="M${-cw/2+6} ${-h-6} q 0 -26 ${cw/2-6} -26 q ${cw/2-6} 0 ${cw/2-6} 26 Z" fill="#f7f3ea"/><path d="M${-cw/2-4} ${-h-10} q 4 18 ${cw/2+4} 18 q ${cw/2} 0 ${cw/2+4} -18 q 0 14 ${-cw/2-4} 14 q ${-cw/2-4} 0 ${-cw/2-4} -14 Z" fill="#ebe5d8"/><rect x="${-cw/2-4}" y="${-h-12}" width="${cw+8}" height="12" rx="6" fill="#f7f3ea"/>`;
  if (o.cap === 'mushroom-band') s += `<rect x="${-cw/2}" y="${-h-18}" width="${cw}" height="30" rx="15" fill="${o.ink}"/><rect x="${-cw/2}" y="${-h-18}" width="${cw}" height="12" rx="6" fill="rgba(255,255,255,.3)"/><rect x="${-cw/2}" y="${-h-2}" width="${cw}" height="9" rx="4" fill="#16283f"/><path d="M${-cw/2+6} ${-h+2.5} h ${cw-12}" stroke="#f2b44a" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="4 3"/>`;
  // face
  const ex = 13, ey = faceY;
  const eye = (cx, kind) => {
    if (kind === 'closed') return `<path d="M${cx-7} ${ey} q 7 6 14 0" stroke="${o.eye}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    if (kind === 'x') return `<path d="M${cx-6} ${ey-6} l 12 12 M${cx+6} ${ey-6} l -12 12" stroke="${o.eye}" stroke-width="3" stroke-linecap="round"/>`;
    if (kind === 'half') return `<path d="M${cx-7} ${ey-2} a 7 8 0 0 0 14 0 Z" fill="${o.eye}"/><rect x="${cx-8}" y="${ey-10}" width="16" height="8" fill="${o.ink}"/>`;
    if (kind === 'star') return `<path d="M${cx} ${ey-9} l 2.6 6 6.4 .6 -4.8 4.3 1.4 6.3 -5.6 -3.3 -5.6 3.3 1.4 -6.3 -4.8 -4.3 6.4 -.6 Z" fill="#f2b44a"/>`;
    return `<ellipse cx="${cx}" cy="${ey}" rx="6.5" ry="8" fill="${o.eye}"/><circle cx="${cx+2}" cy="${ey-2.5}" r="2" fill="${o.ink}"/>`;
  };
  s += eye(-ex, o.eyes === 'wink' ? 'open' : o.eyes);
  s += eye(ex, o.eyes === 'wink' ? 'closed' : o.eyes);
  if (o.brows === 'angry') s += `<path d="M${-ex-8} ${ey-16} l 14 5 M${ex+8} ${ey-16} l -14 5" stroke="${o.eye}" stroke-width="3" stroke-linecap="round"/>`;
  if (o.brows === 'sad') s += `<path d="M${-ex-8} ${ey-12} l 14 -4 M${ex+8} ${ey-12} l -14 -4" stroke="${o.eye}" stroke-width="3" stroke-linecap="round"/>`;
  const my = ey + 20;
  const mouths = { smile:`M-10 ${my} q 10 8 20 0`, grin:`M-12 ${my-2} q 12 14 24 0 Z`, worry:`M-9 ${my+2} q 9 -6 18 0`, flat:`M-9 ${my} h 18`, o:`M0 ${my+1} m -5 0 a 5 6 0 1 0 10 0 a 5 6 0 1 0 -10 0`, sleep:`M-6 ${my} q 6 4 12 0` };
  s += `<path d="${mouths[o.mouth]}" stroke="${o.eye}" stroke-width="3" fill="${o.mouth==='grin' ? o.eye : 'none'}" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (o.cheeks) s += `<circle cx="${-ex-11}" cy="${ey+14}" r="5" fill="${o.blush}"/><circle cx="${ex+11}" cy="${ey+14}" r="5" fill="${o.blush}"/>`;
  s += `</g>`;
  return s;
}
const DEFS = `<defs><linearGradient id="shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="rgba(255,255,255,.08)"/><stop offset=".6" stop-color="rgba(0,0,0,0)"/><stop offset="1" stop-color="rgba(0,0,0,.12)"/></linearGradient></defs>`;
const wrap = (inner, vb='-110 -210 220 240', ground=true, groundColor='rgba(242,238,228,.08)') => `<svg viewBox="${vb}">${DEFS}${ground?`<ellipse cx="0" cy="8" rx="70" ry="9" fill="${groundColor}"/>`:''}${inner}</svg>`;

