(function (root) {
  'use strict';
  const M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const MAX_BYTES = 15 * 1024 * 1024;
  const MAX_UNCOMPRESSED = 60 * 1024 * 1024;
  const MAX_FILES = 3000;
  class AktarimHatasi extends Error { constructor(message){ super(message); this.name='AktarimHatasi'; } }
  function normalize(value){
    return String(value ?? '').toUpperCase().trim().replace(/MEZUN/g, 'MZN')
      .replace(/İ/g,'I').replace(/ı/g,'I').replace(/Ğ/g,'G').replace(/Ş/g,'S')
      .replace(/Ç/g,'C').replace(/Ö/g,'O').replace(/Ü/g,'U')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, '');
  }
  function trialNumber(v){ const match=normalize(v).match(/^(\d+)DENEME(?:SINAVI)?$/); return match ? Number(match[1]) : null; }
  function numericString(v){
    if(v === undefined || v === null || !String(v).trim()) return null;
    const s=String(v).trim().replace(',', '.');
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s))return null;
    return Number.isFinite(Number(s)) ? s : null;
  }
  function parseXml(xml, filename){
    const doc=new DOMParser().parseFromString(xml,'application/xml');
    if(doc.getElementsByTagName('parsererror').length)throw new AktarimHatasi(`${filename} içindeki Excel XML yapısı okunamadı.`);
    return doc;
  }
  function resolvePath(target){
    if(target.startsWith('/'))return target.replace(/^\/+/, '');
    const out=['xl'];
    for(const part of target.split('/')){
      if(!part || part==='.')continue;
      if(part==='..')out.pop(); else out.push(part);
    }
    return out.join('/');
  }
  async function sheetIndex(zip){
    const wb=zip.file('xl/workbook.xml'), relations=zip.file('xl/_rels/workbook.xml.rels');
    if(!wb || !relations)throw new AktarimHatasi('Dosyada geçerli bir Excel çalışma kitabı bulunamadı.');
    const [bookXml, relXml]=await Promise.all([wb.async('string'),relations.async('string')]);
    const book=parseXml(bookXml,'workbook.xml'), rels=parseXml(relXml,'workbook.xml.rels');
    const paths=new Map();
    for(const rel of rels.getElementsByTagNameNS(REL,'Relationship')){
      paths.set(rel.getAttribute('Id'),resolvePath(rel.getAttribute('Target')||''));
    }
    const names=new Map();
    for(const s of book.getElementsByTagNameNS(M,'sheet')){
      const id=s.getAttributeNS(R,'id')||s.getAttribute('r:id');
      if(paths.has(id))names.set(s.getAttribute('name'),paths.get(id));
    }
    return names;
  }
  async function getSharedStrings(zip){
    const item=zip.file('xl/sharedStrings.xml');
    if(!item)return [];
    const xml=parseXml(await item.async('string'),'sharedStrings.xml');
    return Array.from(xml.getElementsByTagNameNS(M,'si'),si=>
      Array.from(si.getElementsByTagNameNS(M,'t'),t=>t.textContent||'').join(''));
  }
  async function loadWorkbook(buffer){
    const bytes=(buffer instanceof Uint8Array)?buffer:new Uint8Array(buffer);
    if(!bytes.length || bytes.length>MAX_BYTES)throw new AktarimHatasi('Excel dosyası boş veya 15 MB sınırını aşıyor.');
    if(typeof JSZip==='undefined')throw new AktarimHatasi('Dosya işleme kütüphanesi yüklenemedi.');
    let zip;
    try{ zip=await JSZip.loadAsync(bytes,{checkCRC32:true}); }
    catch{throw new AktarimHatasi('Dosya geçerli veya sağlam bir .xlsx dosyası değil.');}
    const files=Object.values(zip.files).filter(x=>!x.dir);
    const unpacked=files.reduce((a,f)=>a+(f._data?.uncompressedSize||0),0);
    if(files.length>MAX_FILES||unpacked>MAX_UNCOMPRESSED)throw new AktarimHatasi('Excel dosyasının açılmış boyutu güvenlik sınırını aşıyor.');
    if(zip.file('xl/vbaProject.bin'))throw new AktarimHatasi('Makrolu Excel dosyası desteklenmiyor. Lütfen .xlsx dosyası kullan.');
    const [names,shared]=await Promise.all([sheetIndex(zip),getSharedStrings(zip)]);
    const sheets={};
    await Promise.all(Array.from(names,async ([name,path])=>{
      const file=zip.file(path); if(!file)return;
      const xml=await file.async('string'),doc=parseXml(xml,name);
      const cells=new Map(),occupied=new Set();
      for(const cell of doc.getElementsByTagNameNS(M,'c')){
        const ref=cell.getAttribute('r'); if(!ref)continue;
        let value='';
        const v=cell.getElementsByTagNameNS(M,'v')[0];
        if(v){value=v.textContent||''; if(cell.getAttribute('t')==='s')value=shared[Number(value)]??'';}
        else {
          const inline=cell.getElementsByTagNameNS(M,'is')[0];
          if(inline)value=Array.from(inline.getElementsByTagNameNS(M,'t'),t=>t.textContent||'').join('');
        }
        cells.set(ref,value);
        // A formula is occupied even when its cached/displayed result is blank.
        if(value!==''||cell.getElementsByTagNameNS(M,'f').length)occupied.add(ref);
      }
      sheets[name]={path,xml,cells,occupied};
    }));
    return {zip,sheets};
  }
  function patchSheetXml(xml,updates,sheetName){
    const visited=new Set();
    // Excel may use either <c> or a namespace prefix such as <x:c>.
    // Match both so a styled cell is filled in place, never duplicated.
    const pattern=/<((?:[A-Za-z_][\w.-]*:)?c)\b([^>]*?\br="([A-Z]+\d+)"[^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
    let result=xml.replace(pattern,(whole,tag,attributes,ref,contents)=>{
      if(!updates.has(ref))return whole;
      visited.add(ref);
      const start='<'+tag+attributes.replace(/\s+t="[^"]*"/g,'');
      const prefix=tag.slice(0,-1);
      const value=updates.get(ref);
      const rest=(contents||'').replace(/<(?:[\w.-]+:)?(?:v|is)\b[^>]*(?:\/>|>[\s\S]*?<\/(?:[\w.-]+:)?(?:v|is)>)/g,'');
      return start+'><'+prefix+'v>'+value+'</'+prefix+'v>'+rest+'</'+tag+'>';
    });
    const missing=Array.from(updates.keys()).filter(k=>!visited.has(k));
    if(!missing.length)return result;

    // Insert omitted empty cells without serializing/rebuilding the worksheet.
    // Existing cell styles and all row/column/layout XML remain untouched.
    const columnNumber=ref=>Array.from(ref.match(/^[A-Z]+/)[0]).reduce((sum,char)=>sum*26+char.charCodeAt(0)-64,0);
    for(const ref of missing){
      const rowNo=Number(ref.match(/\d+$/)[0]);
      const value=updates.get(ref);
      const rowPattern=new RegExp('(<((?:[A-Za-z_][\\w.-]*:)?row)\\b[^>]*\\br="'+rowNo+'"[^>]*>)([\\s\\S]*?)(</\\2>)');
      let found=false;
      result=result.replace(rowPattern,(whole,start,rowTag,contents,end)=>{
        found=true;
        const col=columnNumber(ref);
        const next=Array.from(contents.matchAll(/<((?:[A-Za-z_][\w.-]*:)?c)\b[^>]*\br="([A-Z]+\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g))
          .find(match=>columnNumber(match[2])>col);
        const offset=next?next.index:contents.length;
        const prefix=rowTag.slice(0,-3);
        const cell='<'+prefix+'c r="'+ref+'"><'+prefix+'v>'+value+'</'+prefix+'v></'+prefix+'c>';
        return start+contents.slice(0,offset)+cell+contents.slice(offset)+end;
      });
      if(!found)throw new AktarimHatasi(`${sheetName} sayfasında ${rowNo}. sınıf satırı bulunamadı.`);
    }
    return result;
  }
  async function exportWorkbook(target,patches){
    for(const [path,xml] of patches)target.zip.file(path,xml,{createFolders:false});
    return target.zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6},mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  root.NetWorkbook = { AktarimHatasi, normalize, trialNumber, numericString, loadWorkbook, patchSheetXml, exportWorkbook };
})(globalThis);
