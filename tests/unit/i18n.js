import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {dictionaries,translateFor} from '../../js/i18n.js';

const en=dictionaries.en,ptBR=dictionaries['pt-BR'];
const markers=value=>[...value.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();

test('P3.8 translations cover the same keys and markers in both languages',()=>{
  assert.deepEqual(Object.keys(en).sort(),Object.keys(ptBR).sort());
  for(const [key,english] of Object.entries(en)){
    const portuguese=ptBR[key];
    assert.ok(english.trim()&&portuguese.trim(),key);
    assert.deepEqual(markers(english),markers(portuguese),key);
  }
});

test('P3.8 plural forms cover every tp call in both languages',()=>{
  const directory=new URL('../../js/',import.meta.url);
  const keys=new Set(Object.keys(en).filter(key=>key.endsWith('Plural')).map(key=>key.slice(0,-6)));
  for(const file of readdirSync(directory).filter(name=>name.endsWith('.js'))){
    const source=readFileSync(new URL(file,directory),'utf8');
    for(const [,key] of source.matchAll(/\btp\(\s*['"]([^'"]+)['"]/g))keys.add(key);
  }
  assert.ok(keys.size>0);
  for(const key of keys){
    for(const [locale,language] of Object.entries(dictionaries)){
      const plural=key+'Plural';
      assert.ok(Object.hasOwn(language,key)&&Object.hasOwn(language,plural),locale+' '+key);
      assert.equal(translateFor(locale,key,{count:1}),language[key].replaceAll('{count}','1'));
      assert.equal(translateFor(locale,plural,{count:2}),language[plural].replaceAll('{count}','2'));
    }
  }
});

test('P3.8 labels never claim cloud or file synchronization',()=>{
  const allowed=new Map([
    // Product name.
    ['vault.template.objectStorage',/\bCloudflare\b/],
    // Explicit warning about Windows clipboard history.
    ['vault.clipboardWarning',/\b(?:sync across devices|sincronização entre dispositivos)\b/],
  ]);
  const forbidden=/\b(?:sync\w*|cloud\w*|sincroniz\w*|nuv(?:em|ens))\b/i;
  for(const [locale,language] of Object.entries(dictionaries)){
    for(const [key,value] of Object.entries(language)){
      assert.doesNotMatch(allowed.has(key)?value.replace(allowed.get(key),''):value,forbidden,locale+' '+key);
    }
  }
});

test('P4.6 menu and label picker read their labels through the dictionary',()=>{
  const source=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
  const menu=source.match(/<button\b[^>]+id="menu-toggle"[^>]*>/)?.[0]??'';
  const menuLabel="${t('header.menu')}";
  assert.ok(menu.includes(`aria-label="${menuLabel}"`)&&menu.includes(`data-tooltip="${menuLabel}"`),'Menu labels');
  const picker=source.slice(source.indexOf('function openLabelsPickerModal'));
  assert.ok(picker.slice(0,picker.indexOf('${labels.map')).includes("${t('sidebar.labels')}"),'Label picker heading');
  for(const dict of [en,ptBR]){
    assert.ok(dict['header.menu']?.trim());
    assert.ok(dict['sidebar.labels']?.trim());
  }
});
