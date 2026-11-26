// Computed DOM contrast for visible text. Not a replacement for a screen-reader or full WCAG audit.
export const contrastExpression = `(()=>{
  const parse = value => { const parts = value.match(/[\\d.]+/g)?.map(Number); return parts?.length>=3 ? [...parts.slice(0,3),parts[3]??1] : [0,0,0,0] };
  const mix = (base, paint) => paint.slice(0,3).map((n,i)=>n*paint[3]+base[i]*(1-paint[3]));
  const background = el => { const layers=[]; for(let p=el;p;p=p.parentElement)layers.unshift(parse(getComputedStyle(p).backgroundColor)); return layers.reduce(mix,[255,255,255]) };
  const lum = rgb => rgb.map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((a,n,i)=>a+n*[.2126,.7152,.0722][i],0);
  const ratio = (fg,bg) => (Math.max(lum(fg),lum(bg))+.05)/(Math.min(lum(fg),lum(bg))+.05);
  const records=[];
  for(const root of document.querySelectorAll('.dmin-admin,.dmin-admin-dialog')) {
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT); let node;
    while(node=walker.nextNode()) {
      const el=node.parentElement,text=node.textContent.trim(),r=el.getBoundingClientRect(),style=getComputedStyle(el);
      if(!text||r.width<2||r.height<2||style.visibility==='hidden'||style.display==='none'||el.closest('[disabled],.am-sr-only'))continue;
      const fg=parse(style.color),bg=background(el),size=parseFloat(style.fontSize),weight=parseInt(style.fontWeight)||400;
      const value=ratio(mix(bg,fg),bg),required=size>=24||(size>=18.66&&weight>=700)?3:4.5;
      records.push({text:text.slice(0,70),size,color:style.color,background:bg,ratio:Math.round(value*100)/100,required,pass:value>=required});
    }
  }
  return {checked:records.length,minRatio:Math.min(...records.map(r=>r.ratio)),failures:records.filter(r=>!r.pass),smallText:records.filter(r=>r.size<12),records};
})()`
