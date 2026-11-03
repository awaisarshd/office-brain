// QuickAdd: local capture, simple work notes, and one current retro.
module.exports = async ({ app, quickAddApi, obsidian }) => {
  const { Notice } = obsidian;
  const moment = window.moment;
  const labels = ['Task','Quick note','Retro point / feeling','Open current retro',"Today's work note",'New retro','Deployment runbook','Local testing guide','Business / domain knowledge','Meeting','Decision','Project / initiative','Misc note'];
  const action = await quickAddApi.suggester(labels, labels);
  if (!action) return;
  const today = moment().format('YYYY-MM-DD');
  const timestamp = moment().format('YYYY-MM-DD HH:mm');
  const clean = text => String(text).replace(/[\\/:*?"<>|\[\]#\r\n]/g,' ').replace(/\s+/g,' ').replace(/[ .]+$/g,'').trim().slice(0,100);
  const oneLine = text => String(text).replace(/\r?\n/g,' / ').trim();
  async function open(file) {
    const leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file,{active:true,state:{mode:'source',source:false}});
    const editor=leaf.view?.editor;
    if(editor) {
      const lines=editor.getValue().split('\n');
      const line=lines.findIndex(text=>/^-(?: \[ \])? $/.test(text));
      if(line>=0) editor.setCursor({line,ch:lines[line].length});
      editor.focus();
    }
  }
  async function ensureFolder(folder) {
    let current='';
    for(const part of folder.split('/')) {
      current=current?current+'/'+part:part;
      if(!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
    }
  }
  async function insert(target,heading,text) {
    const file=app.vault.getAbstractFileByPath(target);
    if(!file || file.extension!=='md') throw new Error('Capture destination missing: '+target);
    await app.vault.process(file,body=>{
      const source=body.replace(/\r\n/g,'\n');
      const marker=heading+'\n';
      const index=source.indexOf(marker);
      if(index<0) return source.trimEnd()+'\n\n'+heading+'\n\n'+text+'\n';
      const end=index+marker.length;
      return source.slice(0,end)+'\n'+text+'\n'+source.slice(end);
    });
    new Notice('Saved to '+file.basename);
  }
  async function create(template,folder,title,existing='increment',show=true) {
    const filename=clean(title);
    if(!filename || filename==='.' || filename==='..') {new Notice('Please enter a note title.');return;}
    const source=app.vault.getAbstractFileByPath('90 Templates/'+template+'.md');
    let content=await app.vault.read(source);
    content=content.replace(/\{\{([^}]+)\}\}/g,(match,key)=>key==='title'?filename:key==='date:YYYY-MM-DD'?today:match);
    await ensureFolder(folder);
    let target=folder+'/'+filename+'.md';
    const prior=app.vault.getAbstractFileByPath(target);
    if(prior && existing==='open') {if(show) await open(prior);return prior;}
    for(let n=2; app.vault.getAbstractFileByPath(target);n++) target=folder+'/'+filename+' ('+n+').md';
    const file=await app.vault.create(target,content);
    if(show) await open(file);
    return file;
  }
  function currentRetros() {
    return app.vault.getMarkdownFiles().filter(file=>file.path.startsWith('02 Retros/')&&!file.path.slice('02 Retros/'.length).includes('/')).sort((a,b)=>b.stat.mtime-a.stat.mtime||a.path.localeCompare(b.path));
  }
  async function currentRetro(show=false) {
    const files=currentRetros();
    const file=files[0] || await create('Retrospective','02 Retros','Retro — '+today,'open',false);
    if(show) await open(file);
    return file;
  }
  if(action==='Task') {
    const text=await quickAddApi.inputPrompt('What is the next action?');
    if(!text?.trim()) return;
    const due=await quickAddApi.inputPrompt('Due date (optional)','YYYY-MM-DD; leave blank for none','');
    if(due===null || due===undefined) return;
    if(due.trim()&&!moment(due.trim(),'YYYY-MM-DD',true).isValid()) {new Notice('Use YYYY-MM-DD for the due date. Nothing saved.');return;}
    await insert('99 System/Tasks.md','## Tasks','- [ ] '+oneLine(text)+(due.trim()?' 📅 '+due.trim():''));return;
  }
  if(action==='Quick note') {
    const text=await quickAddApi.wideInputPrompt('What do you want to remember?');
    if(!text?.trim()) return;
    await insert('00 Inbox/Notes inbox.md','## Captures','### '+timestamp+'\n'+text.trim());return;
  }
  if(action==='Retro point / feeling') {
    const text=await quickAddApi.inputPrompt('What should we discuss?');
    if(!text?.trim()) return;
    const feeling=await quickAddApi.inputPrompt('How did it feel? (optional)','e.g. blocked, pleased, uncertain','');
    if(feeling===null || feeling===undefined) return;
    const file=await currentRetro();
    await insert(file.path,'## Points to discuss','- [ ] '+timestamp+' — '+oneLine(text)+(feeling.trim()?' — Feeling: '+oneLine(feeling):'')+' #retro');return;
  }
  if(action==='Open current retro') {await currentRetro(true);return;}
  if(action==="Today's work note") {await create('Work log','01 Work log',today,'open');return;}
  if(action==='New retro') {
    const title=await quickAddApi.inputPrompt('Sprint / retro name','e.g. Sprint 3','Retro — '+today);
    if(!title?.trim()) return;
    const older=currentRetros();
    const file=await create('Retrospective','02 Retros',title,'increment',false);
    if(!file) return;
    await ensureFolder('02 Retros/Archive');
    for(const old of older) {
      let target='02 Retros/Archive/'+old.basename+'.md';
      for(let n=2;app.vault.getAbstractFileByPath(target);n++) target='02 Retros/Archive/'+old.basename+' ('+n+').md';
      await app.fileManager.renameFile(old,target);
    }
    await open(file);
    if(older.length) new Notice('Previous retro moved to Archive.');return;
  }
  const mapping={
    'Deployment runbook':['Deployment runbook','03 Knowledge/Runbooks'],
    'Local testing guide':['Local testing guide','03 Knowledge/Testing'],
    'Business / domain knowledge':['Domain knowledge','03 Knowledge/Domain'],
    'Meeting':['Meeting','05 Misc'],
    'Decision':['Decision','03 Knowledge/Decisions'],
    'Project / initiative':['Project','04 Projects'],
    'Misc note':['Misc note','05 Misc']
  };
  const [template,folder]=mapping[action];
  const title=await quickAddApi.inputPrompt('Note title','A specific name helps search');
  if(!title?.trim()) return;
  await create(template,folder,action==='Meeting'?today+' — '+title:title);
};
