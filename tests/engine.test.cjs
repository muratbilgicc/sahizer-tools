// Synthetic data only. Run: npm install --no-save playwright && node tests/engine.test.cjs
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
    const results = await page.evaluate(async () => {
      const engine = window.YKSNetEngine;
      const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
      const assert = (ok,message) => {if(!ok)throw new Error(message);};
      const source = new JSZip();
      const names = ['MF','TM','TYT'];
      const headers = [
        ['TÜRKÇE','MATEMATİK','GEOMETRİ','FİZİK','KİMYA','BİYOLOJİ'],
        ['TÜRKÇE','TARİH','COĞ','FELSEFE','MAT 1','GEO'],
        ['TÜRKÇE','TARİH','COĞ','FELSEFE','MAT 1','GEO','FİZİK','KİMYA','BİYO']
      ];
      const text = (ref,value) => `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
      const row = (r,cls,trial,values) => `<row r="${r}">${cls?text('A'+r,cls):''}${text('B'+r,trial+'. DENEME')}${values.map((v,i)=>`<c r="${String.fromCharCode(67+i)}${r}"><v>${v}</v></c>`).join('')}</row>`;
      source.file('xl/workbook.xml',`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n,i)=>`<sheet name="${n}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`);
      source.file('xl/_rels/workbook.xml.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((n,i)=>`<Relationship Id="rId${i+1}" Target="worksheets/sheet${i+1}.xml"/>`).join('')}</Relationships>`);
      names.forEach((n,i)=>source.file(`xl/worksheets/sheet${i+1}.xml`,`<worksheet xmlns="${ns}"><sheetData><row r="3">${headers[i].map((h,j)=>text(String.fromCharCode(67+j)+'3',h)).join('')}</row>${row(6,'12 '+n+' A',2,headers[i].map((_,j)=>102+j))}${row(7,null,1,headers[i].map((_,j)=>j===2?0:j===3?-0.25:12+j))}</sheetData></worksheet>`));
      const sourceBytes = await source.generateAsync({type:'uint8array'});
      const target = await JSZip.loadAsync(engine.templateBytes());
      const paths = ['xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml','xl/worksheets/sheet3.xml','xl/worksheets/sheet4.xml'];
      // Change only test values; keep embedded template styles and layout.
      function replaceCell(xml,ref,body){
        const re=new RegExp('<((?:[\\w.-]+:)?c)\\b([^>]*\\br="'+ref+'"[^>]*?)(?:/>|>[\\s\\S]*?</\\1>)');
        assert(re.test(xml),'Fixture cell missing: '+ref);
        return xml.replace(re,(whole,tag,attrs)=>'<'+tag+attrs.replace(/\s+t="[^"]*"/g,'')+'>'+body.replace(/<(\/?)(v|f|is|t)\b/g,(_,slash,name)=>'<'+slash+tag.slice(0,-1)+name)+'</'+tag+'>');
      }
      let turkce = await target.file(paths[0]).async('string');
      for(const [ref,body] of [['B3','<v>999</v>'],['C3','<f>IF(1=1,&quot;&quot;,1)</f>'],['B4','<v>0</v>'],['C4','<is><t>Manuel</t></is>']]) {
        turkce=replaceCell(turkce,ref,body);
      }
      target.file(paths[0],turkce);
      let fen = await target.file(paths[3]).async('string');
      fen=replaceCell(fen,'B8','<v>888</v>'); // Unsupported MF/TM subject combination must also survive.
      target.file(paths[3],fen);
      const original={};
      for(const [name,file] of Object.entries(target.files))if(!file.dir)original[name]=await file.async('string');
      const prepared=await engine.prepare(sourceBytes,await target.generateAsync({type:'uint8array'}));
      assert(prepared.summary.preserved===5,'Existing numbers, zero, text and blank-result formula must be preserved');
      const blob=await prepared.generate();
      const exported=await JSZip.loadAsync(await blob.arrayBuffer());
      const sheetXml={};
      for(const p of paths)sheetXml[p]=await exported.file(p).async('string');
      const doc = p => new DOMParser().parseFromString(sheetXml[p],'application/xml');
      const value = (p,ref) => Array.from(doc(p).getElementsByTagNameNS(ns,'c')).find(c=>c.getAttribute('r')===ref)?.getElementsByTagNameNS(ns,'v')[0]?.textContent;
      assert(value(paths[0],'B3')==='999','Existing value overwritten');
      assert(value(paths[0],'B4')==='0','Existing zero overwritten');
      assert(value(paths[3],'B8')==='888','Unsupported existing value removed');
      assert(value(paths[1],'B3')==='13'&&value(paths[1],'C3')==='103','Trial/class/subject keys must handle reversed source trial order');
      assert(value(paths[1],'D3')==='0','Source zero not copied');
      assert(value(paths[3],'B3')==='-0.25','Source negative not copied');
      const cellNodes = xml => new Map(Array.from(xml.matchAll(/<((?:[\w.-]+:)?c)\b[^>]*\br="([A-Z]+\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g),m=>[m[2],m[0]]));
      let added=0;
      for(const [name,xml] of Object.entries(original)) {
        const after=await exported.file(name).async('string');
        if(!paths.includes(name)){assert(after===xml,'Non-worksheet package part changed: '+name);continue;}
        const beforeCells=cellNodes(xml),afterCells=cellNodes(after);
        let normalized=after;
        for(const [ref,node] of afterCells) {
          const previous=beforeCells.get(ref);
          if(node===previous)continue;
          assert(!/<(?:[\w.-]+:)?(?:v|is|f)\b/.test(previous||''),'Occupied cell changed: '+name+'!'+ref);
          const attributes = s => s.match(/^<(?:[\w.-]+:)?c\b([^>]*?)(?:\/?>)/)[1];
          assert(attributes(node)===attributes(previous),'Cell style/attributes changed: '+ref);
          normalized=normalized.replace(node,previous);
          added++;
        }
        assert(normalized===xml,'Worksheet layout or untouched cells changed: '+name);
      }
      assert(added===prepared.summary.filled,'Filled count must describe new cells only');
      const repeat=await engine.prepare(sourceBytes,new Uint8Array(await blob.arrayBuffer()));
      assert(repeat.summary.filled===0&&repeat.patches.size===0,'Second import must be a successful no-op');
      // Excel may omit an empty numeric cell entirely. Inserting it must not serialize the rest of the sheet.
      const omitted=await JSZip.loadAsync(engine.templateBytes());
      const math=await omitted.file(paths[1]).async('string');
      omitted.file(paths[1],math.replace(cellNodes(math).get('B3'),''));
      const omittedResult=await engine.prepare(sourceBytes,await omitted.generateAsync({type:'uint8array'}));
      const insertedZip=await JSZip.loadAsync(await (await omittedResult.generate()).arrayBuffer());
      const inserted=await insertedZip.file(paths[1]).async('string');
      assert(inserted.includes('<x:c r="B3"><x:v>13</x:v></x:c>'),'Omitted blank cell was not inserted');
      const parsed=new DOMParser().parseFromString(inserted,'application/xml');
      assert(!parsed.getElementsByTagName('parsererror').length,'Invalid worksheet XML after insertion');
      const refs=Array.from(parsed.getElementsByTagNameNS(ns,'c'),cell=>cell.getAttribute('r'));
      assert(refs.length===new Set(refs).size,'Duplicate cell addresses after insertion');
      // Equivalent worksheets using the default namespace must work as well.
      const unprefixed=await JSZip.loadAsync(engine.templateBytes());
      for(const p of paths)unprefixed.file(p,(await unprefixed.file(p).async('string')).replaceAll('xmlns:x=','xmlns=').replaceAll('<x:','<').replaceAll('</x:','</'));
      const plainResult=await engine.prepare(sourceBytes,await unprefixed.generateAsync({type:'uint8array'}));
      const plainZip=await JSZip.loadAsync(await (await plainResult.generate()).arrayBuffer());
      const plainMath=new DOMParser().parseFromString(await plainZip.file(paths[1]).async('string'),'application/xml');
      const plainCells=Array.from(plainMath.getElementsByTagNameNS(ns,'c'));
      assert(plainCells.find(c=>c.getAttribute('r')==='B3').getElementsByTagNameNS(ns,'v')[0].textContent==='13','Default namespace export failed');
      assert(plainCells.length===new Set(plainCells.map(c=>c.getAttribute('r'))).size,'Duplicate cells in default namespace export');
      return {newValues:added,preserved:5,checks:'keyed matching, numbers/text/formulas/zero preservation, negative/zero import, exact layout/package preservation, repeat import, omitted cells'};
    });
    console.log('PASS',results);
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
