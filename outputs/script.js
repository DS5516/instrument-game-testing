const chooser=document.querySelector('#chooser');
const welcome=document.querySelector('#welcome');
const player=document.querySelector('#player');
const controls=document.querySelector('#controls');
const art=document.querySelector('#instrument-art');
const audioContext=window.AudioContext||window.webkitAudioContext;
let audio=null,master=null,limiter=null,nextStickingHand='R';
const activeSources=new Set(),activeVoices=new Set(),instrumentVoices=new Map();
const activeControls=new Set(),controlHeld=new WeakMap(),heldPianoKeys=new Map(),selectedGuitarFrets=new Map();let selectedViolinNote=null,clearWindControls=()=>{};
const monophonicInstruments=new Set(['violin','flute','clarinet']);
const violinPositionStarts=[2,3,5,7,9,10,12,14,15,17,19,21],violinFingerOffsets=[0,2,4,5];
const pitchName=midi=>`${['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][midi%12]}${Math.floor(midi/12)-1}`;
const frequency=midi=>440*2**((midi-69)/12);
const sampleCache=new Map(),instrumentBuffers={},loadPromises={},pendingNotes={},pendingDrums=[],loadingInstruments=new Set();
const sampleAnchors={
  piano:Array.from({length:8},(_,oct)=>[21+oct*12,24+oct*12,27+oct*12,30+oct*12]).flat().concat(108).filter(midi=>midi<=108),
  guitar:[38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,64,65,66,67,68,69,70,71,72,73,74,76,77,79],
  violin:[57,60,64,67,69,72,76,79,81,84,88,91,93,96,100],
  flute:[60,64,69,72,76,81,84,88,93,96],
  clarinet:[50,53,58,62,65,70,74,77,82,86,90]
};
const sampleRoots={
  piano:'https://nbrosowsky.github.io/tonejs-instruments/samples/piano/',
  guitar:'https://nbrosowsky.github.io/tonejs-instruments/samples/guitar-acoustic/',
  violin:'https://nbrosowsky.github.io/tonejs-instruments/samples/violin/',
  flute:'https://nbrosowsky.github.io/tonejs-instruments/samples/flute/',
  clarinet:'https://nbrosowsky.github.io/tonejs-instruments/samples/clarinet/'
};
const drumUrls={
  bass:'https://tonejs.github.io/audio/drum-samples/acoustic-kit/kick.mp3',
  snare:'https://tonejs.github.io/audio/drum-samples/acoustic-kit/snare.mp3',
  hat:'https://tonejs.github.io/audio/drum-samples/acoustic-kit/hihat.mp3',
  tomHigh:'https://raw.githubusercontent.com/octalmusic/octal-samples/main/samples/percs/tom-01.wav',
  tomMid:'https://raw.githubusercontent.com/octalmusic/octal-samples/main/samples/percs/tom-02.wav',
  tomLow:'https://raw.githubusercontent.com/octalmusic/octal-samples/main/samples/percs/tom-03.wav',
  ride:'https://raw.githubusercontent.com/octalmusic/octal-samples/main/samples/cymbals/ride-01.wav',
  crash:'https://raw.githubusercontent.com/octalmusic/octal-samples/main/samples/cymbals/crash-01.wav'
};
const midiForName=name=>{const match=String(name).match(/^([A-G])([#♯b♭]?)(-?\d+)$/);if(!match)return null;const semitones={C:0,D:2,E:4,F:5,G:7,A:9,B:11};const accidental=match[2]==='#'||match[2]==='♯'?1:match[2]==='b'||match[2]==='♭'?-1:0;return (Number(match[3])+1)*12+semitones[match[1]]+accidental};
const fileNote=midi=>pitchName(midi).replace('♯','s');
const notes={
  piano:Array.from({length:88},(_,i)=>[pitchName(21+i),frequency(21+i),21+i]),
  guitar:[['E2',82.41],['A2',110],['D3',146.83],['G3',196],['B3',246.94],['E4',329.63]],
  violin:[['G3',196],['D4',293.66],['A4',440],['E5',659.25]],
  flute:Array.from({length:2},(_,oct)=>Array.from({length:7},(_,step)=>72+12*oct+[0,2,4,5,7,9,11][step])).flat().concat(96).map(midi=>[pitchName(midi),midi]),
  clarinet:Array.from({length:40},(_,i)=>52+i).map(midi=>[pitchName(midi),midi])
};
const info={piano:{name:'Piano',icon:'♬',caption:'Tap a key or press its letter key to play',kind:'keys'},guitar:{name:'Guitar',icon:'♩',caption:'Choose a string, then try different frets',kind:'strings'},drums:{name:'Drums',icon:'◉',caption:'Tap a drum or cymbal to play',kind:'drums'},violin:{name:'Violin',icon:'𝄞',caption:'Choose a string and explore its notes',kind:'strings'},flute:{name:'Flute',icon:'〰',caption:'Touch the flute keys to play notes',kind:'buttons'},clarinet:{name:'Clarinet',icon:'♭',caption:'Touch the clarinet keys to play notes',kind:'buttons'}};
const colors={piano:'#e8eee5',guitar:'#f8eee3',drums:'#f7e9e7',violin:'#f1eaf3',flute:'#e8eff2',clarinet:'#f4efdf'};
function setAudioStatus(state,label){const status=document.querySelector('#audio-status'),dot=document.querySelector('.sound-dot');if(status){status.dataset.state=state;status.textContent=label}if(dot)dot.dataset.state=state}
function initAudio(){
  if(!audio&&audioContext){try{audio=new audioContext();master=audio.createGain();limiter=audio.createDynamicsCompressor();limiter.threshold.value=-8;limiter.knee.value=12;limiter.ratio.value=8;limiter.attack.value=.003;limiter.release.value=.18;master.gain.value=Number(document.querySelector('#volume-slider').value)/100;master.connect(limiter);limiter.connect(audio.destination)}catch(error){audio=null;setAudioStatus('error','Audio unavailable');console.error('Audio initialization failed',error);return null}}
  if(!audio){setAudioStatus('error','Audio unavailable');return null}
  if(audio.state==='running'){setAudioStatus('on','Audio enabled');return audio}
  setAudioStatus('waiting','Enabling audio…');audio.resume().then(()=>setAudioStatus(audio.state==='running'?'on':'waiting',audio.state==='running'?'Audio enabled':'Tap a key to enable audio')).catch(error=>{setAudioStatus('error','Audio blocked · interact to retry');console.warn('Audio could not resume',error)});return audio;
}
async function ensureAudioReady(){const ctx=initAudio();if(!ctx)return false;if(ctx.state==='running'){setAudioStatus('on','Audio enabled');return true}try{await ctx.resume();const ready=ctx.state==='running';setAudioStatus(ready?'on':'waiting',ready?'Audio enabled':'Tap a key to enable audio');return ready}catch(error){setAudioStatus('error','Audio blocked · interact to retry');return false}}
function track(source,instrument){
  activeSources.add(source);
  source.addEventListener('ended',()=>activeSources.delete(source),{once:true});
  return source;
}
function stopInstrumentSounds(instrument,immediate=true,fadeTime=.11){
  for(const voice of instrumentVoices.get(instrument)||[])stopVoice(voice,immediate,fadeTime);
  instrumentVoices.get(instrument)?.clear();
}
function stopVoice(voice,immediate=false,fadeTime=.11){
  if(!voice||voice.stopped)return;if(voice.pending){voice.stopped=true;if(voice.actual)stopVoice(voice.actual,immediate,fadeTime);const queue=pendingNotes[voice.instrument];if(queue)pendingNotes[voice.instrument]=queue.filter(note=>note!==voice);return}voice.stopped=true;
  const now=audio?.currentTime||0;
  try{
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value,now);
    if(immediate){voice.gain.gain.setValueAtTime(0,now);voice.source.stop(now)}
    else{voice.gain.gain.linearRampToValueAtTime(0,now+fadeTime);voice.source.stop(now+fadeTime+.005)}
  }catch{try{voice.source.stop()}catch{}}
}
function stopSounds(){
  for(const voice of [...activeVoices])stopVoice(voice,true);
  activeVoices.clear();for(const voices of instrumentVoices.values())voices.clear();activeSources.clear();
}
function clearHeldControls(){
  for(const control of activeControls){control.classList.remove('playing');controlHeld.delete(control)}activeControls.clear();heldPianoKeys.clear();
}
function stopPlayback(){for(const instrument of Object.keys(pendingNotes))delete pendingNotes[instrument];pendingDrums.length=0;stopSounds();clearHeldControls();clearWindControls()}async function loadBuffer(url){
  if(!sampleCache.has(url))sampleCache.set(url,(async()=>{const response=await fetch(url,{mode:'cors',cache:'force-cache'});if(!response.ok)throw new Error(`Sample request failed (${response.status}): ${url}`);return audio.decodeAudioData(await response.arrayBuffer())})());
  return sampleCache.get(url);
}
function urlForNote(instrument,midi){return `${sampleRoots[instrument]}${fileNote(midi)}.mp3`}
function flushPendingNotes(instrument){
  const buffers=instrumentBuffers[instrument],pending=pendingNotes[instrument];if(!buffers?.size||!pending?.length)return;
  if(instrument!=='clarinet'&&loadingInstruments.has(instrument))return;
  const ready=[],waiting=[];
  for(const note of pending){
    if(note.stopped)continue;
    const anchor=nearestAnchor(instrument,note.midi),tooFar=instrument==='clarinet'&&Math.abs(note.midi-anchor)>3;
    if(tooFar&&loadingInstruments.has(instrument)){waiting.push(note);continue}
    if(tooFar){stopVoice(note,true);if(player.dataset.instrument==='clarinet')document.querySelector('#sound-caption').textContent=`A close clarinet sample for ${pitchName(note.midi)} is unavailable`;continue}
    ready.push(note);
  }
  if(waiting.length)pendingNotes[instrument]=waiting;else delete pendingNotes[instrument];
  for(const note of ready){if(!note.stopped)note.actual=playInstrumentNote(instrument,note.midi,note.level,note.control,false)}
}async function loadInstrument(instrument){
  if(loadPromises[instrument])return loadPromises[instrument];
  loadPromises[instrument]=(async()=>{
    await ensureAudioReady();
    const anchors=instrument==='drums'?Object.entries(drumUrls).map(([part,url])=>[part,url]):sampleAnchors[instrument].map(midi=>[midi,urlForNote(instrument,midi)]);
    const buffers=new Map();if(instrument==='clarinet'){instrumentBuffers[instrument]=buffers;loadingInstruments.add(instrument)}
    const loaded=await Promise.allSettled(anchors.map(async([key,url])=>{const buffer=await loadBuffer(url);if(instrument!=='drums'){buffers.set(key,buffer);if(instrument==='clarinet')flushPendingNotes(instrument)}return [key,buffer]}));
    let failed=0;loaded.forEach(result=>{if(result.status==='fulfilled'){if(instrument==='drums')buffers.set(...result.value)}else{failed++;console.warn('Instrument sample unavailable',result.reason)}});
    loadingInstruments.delete(instrument);instrumentBuffers[instrument]=buffers;
    if(player.dataset.instrument===instrument)document.querySelector('#sound-caption').textContent=failed?`${info[instrument].caption} · some samples could not load`:'Instrument sounds ready';
    if(instrument!=='drums'){if(buffers.size)flushPendingNotes(instrument);else{for(const note of pendingNotes[instrument]||[])stopVoice(note,true);delete pendingNotes[instrument]}}
    if(instrument==='drums'&&player.dataset.instrument==='drums')pendingDrums.splice(0).forEach(part=>playDrum(part,false));
    return buffers;
  })();
  return loadPromises[instrument];
}
function nearestAnchor(instrument,midi){const loaded=instrumentBuffers[instrument];const available=loaded?.size?sampleAnchors[instrument].filter(candidate=>loaded.has(candidate)):sampleAnchors[instrument];return available.reduce((best,candidate)=>Math.abs(candidate-midi)<Math.abs(best-midi)?candidate:best,available[0])}
function playBuffer(buffer,rate=1,level=.24,instrument=null,startAt=null){
  const ctx=initAudio();if(!ctx||!buffer)return null;
  const source=track(ctx.createBufferSource(),instrument),gain=ctx.createGain();source.buffer=buffer;source.playbackRate.value=rate;gain.gain.value=level;source.connect(gain);gain.connect(master);
  const voice={source,gain,instrument,stopped:false};activeVoices.add(voice);
  if(instrument){if(!instrumentVoices.has(instrument))instrumentVoices.set(instrument,new Set());instrumentVoices.get(instrument).add(voice)}
  source.addEventListener('ended',()=>{activeVoices.delete(voice);instrumentVoices.get(instrument)?.delete(voice);try{source.disconnect();gain.disconnect()}catch{}},{once:true});source.start(startAt===null?ctx.currentTime:startAt);return voice;
}
function showNoteInfo(instrument,midi,control=''){
  const written=instrument==='clarinet'?midi+2:midi;
  const note=instrument==='clarinet'?`Written ${pitchName(written)} · concert ${pitchName(midi)}`:pitchName(midi);
  document.querySelector('#note-info').textContent=`${info[instrument].name} · ${note}${control?` · ${control}`:''}`;
}
function queuePendingNote(instrument,targetMidi,level,control,monophonic){
  const pending={pending:true,instrument,midi:targetMidi,level,control,stopped:false};pendingNotes[instrument]=pendingNotes[instrument]||[];
  if(monophonic)pendingNotes[instrument]=[pending];else{pendingNotes[instrument].push(pending);if(pendingNotes[instrument].length>8)pendingNotes[instrument].shift()}
  return pending;
}function playInstrumentNote(instrument,targetMidi,level=.24,control='',judge=true){
  if(judge)judgeRhythmInput(instrument,targetMidi);
  const monophonic=monophonicInstruments.has(instrument);
  if(monophonic){stopInstrumentSounds(instrument,instrument==='clarinet'?false:true,instrument==='clarinet' ? .001 : .11);for(const note of pendingNotes[instrument]||[])stopVoice(note,true);pendingNotes[instrument]=[]}
  showNoteInfo(instrument,targetMidi,control||`Note ${instrument==='clarinet'?pitchName(targetMidi+2):pitchName(targetMidi)}`);
  const buffers=instrumentBuffers[instrument];
  if(!buffers?.size)return queuePendingNote(instrument,targetMidi,level,control,monophonic)
  const anchor=nearestAnchor(instrument,targetMidi);if(instrument==='clarinet'&&Math.abs(targetMidi-anchor)>3){if(loadingInstruments.has(instrument))return queuePendingNote(instrument,targetMidi,level,control,monophonic);document.querySelector('#sound-caption').textContent=`A close clarinet sample for ${pitchName(targetMidi)} is unavailable`;return null}const buffer=buffers.get(anchor);
  if(!buffer){document.querySelector('#sound-caption').textContent=`The ${pitchName(targetMidi)} sample is unavailable`;return null}
  const voice=playBuffer(buffer,2**((targetMidi-anchor)/12),level,instrument);if(rhythmState?.instrument===instrument&&voice){const duration=selectedSong.step*60/selectedSong.bpm*.9;window.setTimeout(()=>stopVoice(voice),duration*1000)}return voice;
}function playDrum(part,judge=true){
  if(judge)judgeRhythmInput('drums',null,part);
  const drumLabel=part==='hat'?'Hi-hat':part==='bass'?'Bass drum':part==='snare'?'Snare':part.replace(/([A-Z])/g,' $1');
  const sticking=part==='bass'?'Foot':part==='hat'?'Right hand or foot':nextStickingHand==='R'?'Right hand':'Left hand';
  if(part!=='bass'&&part!=='hat')nextStickingHand=nextStickingHand==='R'?'L':'R';
  document.querySelector('#note-info').textContent=`Drums · ${drumLabel} · percussion pad · Suggested: ${sticking}`;
  const buffers=instrumentBuffers.drums;if(!buffers){pendingDrums.push(part);if(pendingDrums.length>6)pendingDrums.shift();return}
  const buffer=buffers.get(part);if(!buffer){document.querySelector('#sound-caption').textContent=`The ${part} sample is unavailable`;return}
  return playBuffer(buffer,1,.32);
}function hitDrum(part){return playDrum(part)}
function flash(button){button.classList.add('playing');window.setTimeout(()=>button.classList.remove('playing'),260)}
function makeButton(label,cls=''){const b=document.createElement('button');b.type='button';b.className=cls;b.textContent=label;b.setAttribute('aria-label',`Play ${label}`);return b}
function releaseControl(button,immediate=false){
  const held=controlHeld.get(button);if(!held)return;controlHeld.delete(button);activeControls.delete(button);button.classList.remove('playing');
  if(held.release&&held.voice)stopVoice(held.voice,immediate);
}
function wirePlay(button,callback,{release=false}={}){
  const press=event=>{if(event)event.preventDefault();if(controlHeld.has(button))return;const voice=callback();controlHeld.set(button,{voice,release});activeControls.add(button);button.classList.add('playing');if(!release&&voice?.source)voice.source.addEventListener('ended',()=>releaseControl(button),{once:true});};
  button.addEventListener('pointerdown',event=>{press(event);try{button.setPointerCapture(event.pointerId)}catch{}});
  button.addEventListener('pointerup',()=>releaseControl(button));button.addEventListener('pointercancel',()=>releaseControl(button));button.addEventListener('lostpointercapture',()=>releaseControl(button));
  button.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&!event.repeat)press(event)});
  button.addEventListener('keyup',event=>{if(event.key==='Enter'||event.key===' ')releaseControl(button)});
}function buildPiano(){
  const keys=document.createElement('div');keys.className='keys';const white=notes.piano.filter(([, ,m])=>![1,3,6,8,10].includes(m%12)),black=notes.piano.filter(([, ,m])=>[1,3,6,8,10].includes(m%12));
  const positions=new Map();white.forEach(([label,,midi],i)=>positions.set(midi,i));
  white.forEach(([label,,midi])=>{const b=makeButton(label,'white-key');b.setAttribute('aria-label',`Play ${label}`);wirePlay(b,()=>playInstrumentNote('piano',midi,.24,'Piano key'),{release:true});keys.appendChild(b)});
  black.forEach(([label,,midi])=>{const b=makeButton(label,'black-key');b.style.left=`${(positions.get(midi-1)+1)*28-9}px`;b.setAttribute('aria-label',`Play ${label}`);wirePlay(b,()=>playInstrumentNote('piano',midi,.24,'Piano key'),{release:true});keys.appendChild(b)});
  const hint=document.createElement('p');hint.className='key-hint';hint.textContent='Full 88-key range · scroll to explore';
  controls.append(keys,hint);
}
// C–B are note shortcuts (written C4–B4); the remaining keys operate the
// clarinet's physical controls. T is the left-thumb hole key.
const clarinetNoteKeyboardMap=Object.freeze({KeyC:'C4',KeyD:'D4',KeyE:'E4',KeyF:'F4',KeyG:'G4',KeyA:'A4',KeyB:'B4'});
const clarinetKeyboardMap=Object.freeze({KeyT:'T',KeyW:'R',KeyQ:'L1',KeyS:'L2',KeyH:'L3',KeyN:'R1',KeyM:'R2',KeyV:'R3',KeyJ:'A',KeyK:'G#-side',KeyX:'Eb',KeyU:'E/B-L',KeyI:'F-R',KeyO:'F#-R',KeyP:'C#-L',KeyR:'G#-L',KeyY:'B'});
const clarinetComputerKeyByModelKey=Object.fromEntries(Object.entries(clarinetKeyboardMap).map(([code,modelKey])=>[modelKey,code.replace(/^Key/,'')]));
let clarinetKeyboardKeydown=()=>{},clarinetKeyboardKeyup=()=>{},releaseClarinetKeyboard=()=>{};const pianoKeyMap={z:48,s:49,x:50,d:51,c:52,v:53,g:54,b:55,h:56,n:57,j:58,m:59,',':60,l:61,'.':62,';':63,'/':64,q:60,2:61,w:62,3:63,e:64,r:65,5:66,t:67,6:68,y:69,7:70,u:71,i:72,9:73,o:74,0:75,p:76};
function playFromComputerKey(event){
  if(player.classList.contains('hidden')||player.dataset.instrument!=='piano'||event.repeat||event.ctrlKey||event.altKey||event.metaKey)return;
  const keyName=event.key.toLowerCase(),midi=pianoKeyMap[keyName];if(!midi||heldPianoKeys.has(keyName))return;
  event.preventDefault();const voice=playInstrumentNote('piano',midi,.24,'Computer key '+keyName.toUpperCase());heldPianoKeys.set(keyName,voice);
  const key=controls.querySelector(`[aria-label="Play ${pitchName(midi)}"]`);if(key){key.classList.add('playing');activeControls.add(key);}
}
function releasePianoComputerKey(event){
  const keyName=event.key.toLowerCase();if(!heldPianoKeys.has(keyName))return;const voice=heldPianoKeys.get(keyName);heldPianoKeys.delete(keyName);if(voice)stopVoice(voice);const midi=pianoKeyMap[keyName];const key=controls.querySelector(`[aria-label="Play ${pitchName(midi)}"]`);if(key){key.classList.remove('playing');activeControls.delete(key)}
}function renderGuitarSvg(){
  return `<svg class="guitar-diagram" viewBox="0 0 560 150" role="img" aria-label="Acoustic guitar with six strings, neck, bridge, and sound hole"><defs><linearGradient id="guitarWood" x2="0" y2="1"><stop stop-color="#e5b17b"/><stop offset=".55" stop-color="#bd7945"/><stop offset="1" stop-color="#85502f"/></linearGradient></defs><path class="guitar-body" d="M335 26Q368 8 393 30Q408 45 396 62Q390 74 397 84Q412 102 394 122Q371 145 335 124L311 104L306 87L62 87V63L306 63L311 46Z"/><path class="guitar-neck-wood" d="M57 61H345V89H57Z"/><path class="guitar-head" d="M57 61H30Q17 61 17 75Q17 89 30 89H57Z"/><circle class="guitar-soundhole" cx="354" cy="75" r="24"/><path class="guitar-bridge" d="M382 57Q389 75 382 93"/>${Array.from({length:6},(_,i)=>{const y=66+i*4,stringIndex=5-i;return `<g class="guitar-svg-string" data-guitar-string="${stringIndex}" role="button" tabindex="0" aria-label="Strum ${notes.guitar[stringIndex][0]} string"><line class="guitar-string-hit" x1="22" y1="${y}" x2="390" y2="${y}"/><line class="guitar-string-visible" x1="22" y1="${y}" x2="390" y2="${y}"/></g>`}).join("")}<path class="guitar-fret-preview" d="M105 63V87M149 63V87M187 63V87M221 63V87M251 63V87M278 63V87M302 63V87"/><circle class="guitar-tuner" cx="29" cy="56" r="4"/><circle class="guitar-tuner" cx="42" cy="56" r="4"/><circle class="guitar-tuner" cx="29" cy="94" r="4"/><circle class="guitar-tuner" cx="42" cy="94" r="4"/></svg>`;
}
function renderViolinSvg(){
  return `<svg class="violin-diagram" viewBox="0 0 560 150" role="img" aria-label="Violin body with neck, bridge, tailpiece, and four strings"><defs><linearGradient id="violinWood" x2="0" y2="1"><stop stop-color="#d69a61"/><stop offset=".5" stop-color="#9a4f2d"/><stop offset="1" stop-color="#6e3928"/></linearGradient></defs><path class="violin-neck-wood" d="M18 61H385V91H18Z"/><path class="violin-body" d="M381 31Q403 12 430 24Q454 34 447 58Q440 68 455 75Q440 83 447 96Q454 120 430 130Q403 142 381 123Q366 110 373 94L395 85L373 75Q366 54 381 31Z"/><path class="violin-waist" d="M397 50Q410 55 402 73L393 75M397 104Q410 99 402 81L393 79"/><path class="violin-f-hole" d="M418 54Q407 62 416 71M418 99Q407 91 416 82"/><path class="violin-tailpiece" d="M431 66L465 74L465 82L431 90Z"/><path class="violin-bridge" d="M389 54Q394 75 389 96"/><path class="violin-string-lines" d="M25 66H453M25 74H453M25 82H453M25 90H453"/><path class="violin-scroll" d="M18 58Q0 60 5 75Q9 86 22 83Q31 80 23 72Q16 69 13 75"/></svg>`;
}
function buildStrings(id){
  if(id==='violin')art.innerHTML=renderViolinSvg();else if(id==='guitar')art.innerHTML=renderGuitarSvg();
  const board=document.createElement('div');board.className=`string-board instrument-neck ${id}-neck`;
  const header=document.createElement('div');header.className='neck-labels';header.innerHTML=id==='guitar'?'<span>LOW E</span><span>OPEN · FRETS 1–24</span><span>HIGH E</span>':'<span>G · LOW</span><span>OPEN · POSITIONS I–XII · FINGERS 1–4</span><span>E · HIGH</span>';board.append(header);
  const neck=document.createElement('div');neck.className=`neck ${id}-fingerboard`;
  const stringData=notes[id].map(([label,base])=>({label,baseMidi:Math.round(69+12*Math.log2(base/440))}));
  // Extend the existing first-position fingering pattern through position XII.
  const count=id==='guitar'?25:49;
  stringData.forEach(({label,baseMidi},stringIndex)=>{
    const string=document.createElement('div');string.className='neck-string';string.style.top=`${100*stringIndex/stringData.length}%`;string.style.height=`${100/stringData.length}%`;string.style.setProperty('--string-weight',`${Math.max(1.5,4.3-stringIndex*.48)}px`);
    const name=document.createElement('span');name.className='neck-string-name';name.textContent=label;string.append(name);
    const path=document.createElement('div');path.className='string-path';string.append(path);
    for(let position=0;position<count;position++){
      const semitones=id==='guitar'?position:(position===0?0:violinPositionStarts[Math.floor((position-1)/4)]+violinFingerOffsets[(position-1)%4]),midi=baseMidi+semitones;
      const violinFinger=position===0?0:(position-1)%4+1,violinShift=position===0?0:Math.floor((position-1)/4)+1;
      const button=makeButton(id==='guitar'?String(position):String(violinFinger),`position-button ${position===0?'open-position':''}`);
      const fretEdge=n=>100*(1-2**(-n/12));
      button.style.left=`${position===0?6:6+94*(fretEdge(semitones-1)+fretEdge(semitones))/2}%`;
      const place=id==='guitar'?(position===0?'open string':`fret ${position}`):(position===0?'open string':`position ${violinShift}, finger ${violinFinger}`);
      button.setAttribute('aria-label',`Play ${label} string, ${place}, ${pitchName(midi)}`);
      button.title=`${label} string · ${place} · ${pitchName(midi)}`;
      button.addEventListener('click',()=>{document.querySelector('#note-info').textContent=`${info[id].name} · ${pitchName(midi)} · ${label} string · ${place}`});
      wirePlay(button,()=>{board.querySelectorAll('.selected-position').forEach(el=>el.classList.remove('selected-position'));button.classList.add('selected-position');if(id==='guitar')selectedGuitarFrets.set(stringIndex,position);else selectedViolinNote={midi,label,place};string.classList.add('playing');window.setTimeout(()=>string.classList.remove('playing'),280);return playInstrumentNote(id,midi,.24,`${label} string · ${place}`)},{release:id==='violin'});string.append(button);
    }
    neck.append(string);
  });
  const frets=document.createElement('div');frets.className='fret-wires';if(id==='guitar')for(let fret=1;fret<=24;fret++){const wire=document.createElement('i');wire.style.left=`${6+94*(1-2**(-fret/12))}%`;frets.append(wire)}neck.append(frets);
  if(id==='violin'){const bridge=document.createElement('i');bridge.className='violin-bridge';bridge.setAttribute('aria-hidden','true');neck.append(bridge)}board.append(neck);controls.appendChild(board);
  if(id==='guitar'){art.querySelectorAll('[data-guitar-string]').forEach(line=>{const strum=()=>{const index=Number(line.dataset.guitarString),fret=selectedGuitarFrets.get(index)||0,entry=notes.guitar[index],base=Math.round(69+12*Math.log2(entry[1]/440)),midi=base+fret;line.classList.add('strummed');window.setTimeout(()=>line.classList.remove('strummed'),180);playInstrumentNote('guitar',midi,.24,`${entry[0]} string · fret ${fret}`)};line.addEventListener('click',strum);line.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&!event.repeat){event.preventDefault();strum()}})})}
  if(id==='violin'){const bow=makeButton('Hold bow to play selected note','bow-control');bow.disabled=true;const hint=document.createElement('p');hint.className='key-hint';hint.textContent='Choose a finger position, then hold the bow control to sustain the note.';wirePlay(bow,()=>selectedViolinNote?playInstrumentNote('violin',selectedViolinNote.midi,.24,`${selectedViolinNote.label} string · ${selectedViolinNote.place} · bow`):null,{release:true});controls.append(bow,hint);board.querySelectorAll('.position-button').forEach(button=>button.addEventListener('click',()=>{bow.disabled=false}))}
}
function renderFluteSvg(){
  const keys=[['T',225,67],['B',225,48],['Bb',245,48],['L1',275,92],['L2',325,92],['L3',375,92],['G#',405,93],['R1',460,92],['R2',510,92],['R3',560,92],['D',610,92],['Eb',630,92],['C',654,92],['C#',670,92],['Bfoot',692,92]];
  const keyMarkup=keys.map(([key,x,y])=>`<g class="wind-key open" data-key="${key}"><circle class="key-rim" cx="${x}" cy="${y}" r="12"/><circle class="key-pad" cx="${x}" cy="${y}" r="7"/><text x="${x}" y="${y+27}">${key}</text></g>`).join('');
  return `<svg class="flute-diagram" viewBox="0 0 730 150" role="img" aria-label="Concert flute with keys and tone holes"><defs><linearGradient id="fluteMetal" x2="0" y2="1"><stop stop-color="#f9f7e9"/><stop offset=".42" stop-color="#adb3ad"/><stop offset=".68" stop-color="#f5f3e7"/><stop offset="1" stop-color="#91968f"/></linearGradient></defs><path class="flute-tube" d="M34 73 Q34 62 48 62 H636 Q665 62 674 76 V95 Q665 108 636 108 H48 Q34 108 34 97Z"/><path class="flute-joint" d="M48 62 H204 V108 H48 Q34 108 34 95 V75 Q34 62 48 62Z"/><path class="flute-joint" d="M636 62 H656 Q674 62 674 80 V91 Q674 108 656 108 H636Z"/><path class="flute-rod" d="M221 57H624M239 113H618"/><path class="lip-plate" d="M89 54 Q130 42 171 54 L166 65 Q129 58 94 66Z"/><ellipse class="embouchure" cx="132" cy="58" rx="11" ry="4"/><path class="joint-line" d="M204 62V108M636 62V108"/>${keyMarkup}</svg>`;
}
function renderClarinetSvg(){
  const keys=[
    ['T',74,329,'back','T'],['R',118,329,'back','W'],
    ['L1',220,356,'ring','Q'],['L2',220,416,'ring','S'],['L3',220,476,'tone','H'],
    ['R1',220,625,'ring','N'],['R2',220,685,'ring','M'],['R3',220,745,'ring','V'],
    ['A',277,356,'side','J'],['G#-side',281,411,'side','K'],['Eb',158,469,'side','X'],['B',281,536,'side','Y'],
    ['C#-L',151,608,'pinky','P'],['E/B-L',151,653,'pinky','U'],['F-L',151,698,'pinky',''],['F#-L',151,743,'pinky',''],['G#-L',151,788,'pinky',''],
    ['E/B-R',289,608,'pinky',''],['F-R',289,653,'pinky','I'],['F#-R',289,698,'pinky','O'],['G#-R',289,743,'pinky','']
  ];
  const actionByKey={'E/B-L':'E/B','E/B-R':'E/B','F-L':'F','F-R':'F','F#-L':'F#','F#-R':'F#','G#-L':'G#','G#-R':'G#','C#-L':'C#'};
  const fingerForKey={T:'Left thumb · thumb hole',R:'Left thumb · register vent',L1:'Left index · ring',L2:'Left middle · ring',L3:'Left ring finger · tone hole',R1:'Right index · ring',R2:'Right middle · ring',R3:'Right ring finger · tone hole',A:'Left index · A key','G#-side':'Left index · side G-sharp key',Eb:'Left little finger · E-flat sliver key',B:'Right little finger · B/F-sharp sliver key','C#-L':'Left little finger · C-sharp/G-sharp key','E/B-L':'Left little finger · low E/B key','F-L':'Left little finger · low F/C key','F#-L':'Left little finger · low F-sharp/C-sharp key','G#-L':'Left little finger · G-sharp/D-sharp key','E/B-R':'Right little finger · low E/B key','F-R':'Right little finger · low F/C key','F#-R':'Right little finger · low F-sharp/C-sharp key','G#-R':'Right little finger · G-sharp/D-sharp key'};
  const keyMarkup=keys.map(([key,x,y,type,computerKey])=>{
    const action=actionByKey[key]||key, label=key==='G#-side'?'G♯ side':key==='B'?'B/F♯':key.replace('&','&amp;').replace('#','♯'), isMain=type==='ring'||type==='tone';
    const target=isMain?17:type==='back'?16:15;
    const armX=type==='ring'||type==='tone'?267:type==='back'?x: x<200?180:264;
    const arm=isMain?`<path class="clarinet-key-arm-shadow" d="M${x+12} ${y}L${armX} ${y}"/><path class="clarinet-key-arm" d="M${x+12} ${y}L${armX} ${y}"/>`:type==='back'?'':`<path class="clarinet-key-arm-shadow" d="M${x+(x<200?10:-10)} ${y}L${armX} ${y}"/><path class="clarinet-key-arm" d="M${x+(x<200?10:-10)} ${y}L${armX} ${y}"/>`;
    const hinge=type==='back'?'':`<circle class="clarinet-hinge" cx="${armX}" cy="${y}" r="3.4"/><circle class="clarinet-hinge-pin" cx="${armX}" cy="${y}" r="1.2"/>`;
    const face=type==='ring'?`<circle class="clarinet-ring-hole" cx="${x}" cy="${y}" r="10"/>`:type==='tone'?`<circle class="clarinet-hole-edge" cx="${x}" cy="${y}" r="12"/><circle class="clarinet-hole" cx="${x}" cy="${y}" r="8"/>`:type==='pinky'?`<ellipse class="clarinet-pinky-touch" cx="${x}" cy="${y}" rx="9" ry="14" transform="rotate(-22 ${x} ${y})"/>`:type==='back'?(key==='T'?`<circle class="clarinet-hole-edge" cx="${x}" cy="${y}" r="9"/><circle class="clarinet-hole" cx="${x}" cy="${y}" r="5"/>`:`<ellipse class="clarinet-cup" cx="${x}" cy="${y}" rx="11" ry="7"/>`):`<ellipse class="clarinet-cup" cx="${x}" cy="${y}" rx="12" ry="8" transform="rotate(-16 ${x} ${y})"/><circle class="clarinet-cup-screw" cx="${x-4}" cy="${y}" r="1.4"/>`;
    const labelX=type==='ring'||type==='tone'?x+28:type==='pinky'&&x<200?x-14:x+18, labelY=y+3;
    const keyboard=computerKey?`<text class="clarinet-computer-key" x="${labelX}" y="${y+15}">${computerKey}</text>`:'';
    const names=type==='pinky'?`<text class="clarinet-key-name" x="${labelX}" y="${labelY}">${label.replace('-L',' · LH').replace('-R',' · RH')}</text>`:`<text class="clarinet-key-name" x="${labelX}" y="${labelY}">${label}</text>`;
    return `<g class="wind-key clarinet-key ${type} open" data-key="${key}" data-function="${action}" data-finger="${fingerForKey[key]}" data-computer-key="${computerKey||''}" aria-label="${fingerForKey[key]}"><circle class="clarinet-touch-target" cx="${x}" cy="${y}" r="${target}"/>${arm}${hinge}${type==='ring'?`<circle class="key-rim" cx="${x}" cy="${y}" r="16"/>`:''}${face}${type==='side'||type==='pinky'||type==='back'&&key==='R'?`<circle class="clarinet-key-cap" cx="${x}" cy="${y}" r="${type==='pinky'?6:5}"/>`:''}${names}${keyboard}</g>`;
  }).join('');
  const posts=[[267,340],[267,400],[267,460],[267,520],[267,610],[267,655],[267,700],[267,745],[174,340],[174,395],[174,450],[174,605],[174,650],[174,695],[174,740],[174,785]].map(([x,y])=>`<circle class="clarinet-post" cx="${x}" cy="${y}" r="3"/>`).join('');
  return `<svg class="clarinet-diagram rebuilt" viewBox="0 0 420 1120" role="img" aria-label="Boehm B-flat clarinet, front keywork view with six main finger positions in one line, side keys and duplicated left and right pinky stacks; a rear inset shows the left-thumb hole and register key"><defs>
    <linearGradient id="clarinetBody" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#050706"/><stop offset=".12" stop-color="#343a34"/><stop offset=".24" stop-color="#141a17"/><stop offset=".52" stop-color="#070a09"/><stop offset=".76" stop-color="#252b26"/><stop offset=".9" stop-color="#111613"/><stop offset="1" stop-color="#030504"/></linearGradient>
    <linearGradient id="clarinetSilver" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#656a67"/><stop offset=".18" stop-color="#f1f1e9"/><stop offset=".34" stop-color="#9a9f9b"/><stop offset=".52" stop-color="#fffef6"/><stop offset=".72" stop-color="#888e8a"/><stop offset=".88" stop-color="#f5f3ea"/><stop offset="1" stop-color="#646a66"/></linearGradient>
    <linearGradient id="clarinetReed" x1="0" x2="1"><stop stop-color="#705039"/><stop offset=".45" stop-color="#d1ae83"/><stop offset="1" stop-color="#684832"/></linearGradient>
    <linearGradient id="clarinetBell" x1="0" x2="1"><stop stop-color="#090d0b"/><stop offset=".25" stop-color="#292e29"/><stop offset=".5" stop-color="#080b09"/><stop offset=".78" stop-color="#3b403a"/><stop offset="1" stop-color="#080b09"/></linearGradient></defs>
    <ellipse class="clarinet-shadow" cx="210" cy="1084" rx="104" ry="15"/><path class="clarinet-bell" d="M169 899H251V985Q251 1015 278 1037Q307 1058 329 1082Q210 1110 91 1082Q113 1058 142 1037Q169 1015 169 985Z"/><ellipse class="clarinet-bell-rim" cx="210" cy="1082" rx="119" ry="25"/><ellipse class="clarinet-bell-opening" cx="210" cy="1082" rx="84" ry="12"/>
    <path class="clarinet-joint" d="M174 222Q210 213 246 222V570H174Z"/><path class="clarinet-joint" d="M174 586H246V913Q210 923 174 913Z"/><path class="clarinet-barrel" d="M175 145Q210 137 245 145V225Q210 235 175 225Z"/><path class="clarinet-mouthpiece" d="M187 24Q210 11 233 24L245 140Q210 151 175 140Z"/><path class="clarinet-reed" d="M198 26Q210 35 222 26L226 133Q210 140 194 133Z"/><path class="clarinet-ligature" d="M175 65Q210 77 245 65M178 111Q210 121 242 111"/><path class="clarinet-ligature-screw" d="M237 66L253 69L251 82L237 79M234 111L250 114L248 127L234 124"/>
    <path class="clarinet-body-highlight" d="M183 227V565M183 591V905M190 245V550M190 610V886"/><path class="clarinet-body-edge" d="M242 244V558M242 608V889"/><path class="clarinet-joint-ring" d="M167 215Q210 226 253 215M167 238Q210 249 253 238M167 566Q210 578 253 566M167 585Q210 597 253 585M167 908Q210 920 253 908M169 932Q210 946 251 932M143 1002Q210 1024 277 1002"/>
    <g class="clarinet-tone-holes"><circle cx="220" cy="356" r="12"/><circle cx="220" cy="416" r="12"/><circle cx="220" cy="476" r="12"/><circle cx="220" cy="625" r="12"/><circle cx="220" cy="685" r="12"/><circle cx="220" cy="745" r="12"/></g>
    <path class="clarinet-key-rod-shadow" d="M267 330V540M267 600V820M174 330V540M174 600V820"/><path class="clarinet-key-rod" d="M267 330V540M267 600V820M174 330V540M174 600V820"/><path class="clarinet-linkage" d="M220 356H267M220 416H267M220 476H267M220 625H267M220 685H267M220 745H267M174 600V810M267 600V810"/>
    <g class="clarinet-thumb-inset"><rect x="20" y="270" width="138" height="205" rx="12"/><text x="89" y="292" text-anchor="middle">REAR · LEFT THUMB</text><path d="M57 308Q89 300 121 308V454Q89 463 57 454Z"/></g>
    <path class="clarinet-thumb-rest" d="M251 844Q281 830 296 850L291 900Q272 910 254 896Z"/><path class="clarinet-thumb-rest-highlight" d="M260 852Q274 846 285 853"/>${posts}${keyMarkup}</svg>`;
}function updateWindDiagram(pressedKeys){
  const pressed=new Set(pressedKeys);art.querySelectorAll('.wind-key[data-key]').forEach(key=>{const isPressed=pressed.has(key.dataset.key)||pressed.has(key.dataset.function);key.classList.toggle('pressed',isPressed);key.classList.toggle('open',!isPressed);key.setAttribute('aria-pressed',String(isPressed))});
}
function buildClarinetViewControls(svg){
  const toolbar=document.createElement('div');toolbar.className='clarinet-view-tools';toolbar.setAttribute('aria-label','Clarinet viewing controls');
  const views={Closeup:[18,250,385,650],Full:[0,0,420,1120],Upper:[130,300,220,300],Lower:[130,555,220,305],Thumb:[18,270,150,220]};let view='Closeup',zoom=1,rotated=false;
  const apply=()=>{const [x,y,w,h]=views[view],nextW=w/zoom,nextH=h/zoom;svg.setAttribute('viewBox',`${x+(w-nextW)/2} ${y+(h-nextH)/2} ${nextW} ${nextH}`);svg.classList.toggle('rotated',rotated);toolbar.querySelectorAll('[data-view]').forEach(button=>{const selected=button.dataset.view===view;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected))});const rotateButton=toolbar.querySelector('.rotate-button');if(rotateButton)rotateButton.setAttribute('aria-pressed',String(rotated))};
  Object.keys(views).forEach(name=>{const button=makeButton(name,'clarinet-view-button');button.dataset.view=name;button.setAttribute('aria-label','View clarinet '+name.toLowerCase()+' section');button.setAttribute('aria-pressed',String(name===view));button.addEventListener('click',()=>{view=name;zoom=1;apply()});toolbar.append(button)});
  const minus=makeButton('−','clarinet-view-button zoom-button');minus.setAttribute('aria-label','Zoom out on clarinet');minus.addEventListener('click',()=>{zoom=Math.max(.75,zoom/1.2);apply()});
  const plus=makeButton('+','clarinet-view-button zoom-button');plus.setAttribute('aria-label','Zoom in on clarinet');plus.addEventListener('click',()=>{zoom=Math.min(2.5,zoom*1.2);apply()});
  const rotate=makeButton('↻','clarinet-view-button rotate-button');rotate.setAttribute('aria-label','Rotate clarinet view');rotate.setAttribute('aria-pressed',String(rotated));rotate.addEventListener('click',()=>{rotated=!rotated;rotate.setAttribute('aria-pressed',String(rotated));apply()});toolbar.append(minus,plus,rotate);apply();return toolbar;
}function sameKeySet(left,right){return left.size===right.size&&[...left].every(key=>right.has(key))}
function buildWind(id){
  const fingeringMap=id==='flute'?{
    C5:['L1','Eb'],D5:['T','L2','L3','R1','R2','R3'],E5:['T','L2','L3','R1','R2','R3','Eb'],F5:['T','L1','L2','L3','R1','R2','Eb'],G5:['T','L1','L2','L3','R1','Eb'],A5:['T','L1','L2','L3','G#','Eb'],B5:['T','L1','R1','Eb'],
    C6:['B','L1','Eb'],D6:['T','L2','L3','Eb'],E6:['T','L1','L2','L3','G#','R1','R2','R3','Eb'],F6:['T','L1','L2','L3','R1','R2','Eb'],G6:['L1','L2','L3','Eb'],A6:['T','L2','R1','Eb'],B6:['T','R1','D'],C7:['L1','L2','L3','G#','R1','Bfoot']
  }:{
    // Boehm-system standard fingerings transcribed from the Woodwind Fingering Guide.
    E3:['T','L1','L2','L3','R1','R2','R3','E/B'],F3:['T','L1','L2','L3','R1','R2','R3','F'],'F♯3':['T','L1','L2','L3','R1','R2','R3','F#'],G3:['T','L1','L2','L3','R1','R2','R3'],'G♯3':['T','L1','L2','L3','R1','R2','R3','G#'],A3:['T','L1','L2','L3','R1','R2'],'A♯3':['T','L1','L2','L3','R1'],B3:['T','L1','L2','L3','R2'],C4:['T','L1','L2','L3'],'C♯4':['T','L1','L2','L3','C#'],D4:['T','L1','L2'],'D♯4':['T','L1','L2','Eb'],E4:['T','L1'],F4:['T'],'F♯4':['L1'],G4:[],'G♯4':['G#-side'],A4:['A'],'A♯4':['R','A'],B4:['T','R','L1','L2','L3','R1','R2','R3','E/B'],C5:['T','R','L1','L2','L3','R1','R2','R3','F'],'C♯5':['T','R','L1','L2','L3','R1','R2','R3','F#'],D5:['T','R','L1','L2','L3','R1','R2','R3'],'D♯5':['T','R','L1','L2','L3','R1','R2','R3','G#'],E5:['T','R','L1','L2','L3','R1','R2'],F5:['T','R','L1','L2','L3','R1'],'F♯5':['T','R','L1','L2','L3','R2'],G5:['T','R','L1','L2','L3'],'G♯5':['T','R','L1','L2','L3','C#'],A5:['T','R','L1','L2'],'A♯5':['T','R','L1','L2','Eb'],B5:['T','R','L1'],C6:['T','R'],'C♯6':['T','R','L2','L3','R1','R2'],D6:['T','R','L2','L3','R1','G#'],'D♯6':['T','R','L2','L3','R1','B','G#'],E6:['T','R','L2','L3','G#'],F6:['T','R','L2','L3','C#','G#'],'F♯6':['T','R','L2','G#'],G6:['T','R','L2','R1','R2','G#']
  };
  const pressed=new Set();let selectedWrittenMidi=null,highRegister=false,practiceTarget=null,fingerGuide=true,practiceStatus=null,keyboardNote={code:null,label:null,chartLabel:null,voice:null},registerLatched=false,clarinetAccidental='natural',startNoteShortcut=()=>false,setAccidental=()=>{},stopOpenClarinet=()=>{};
  art.innerHTML=id==='flute'?renderFluteSvg():renderClarinetSvg();
  const clarinetFunctions=new Map([...art.querySelectorAll('.clarinet-key')].map(key=>[key.dataset.key,key.dataset.function||key.dataset.key]));
  const currentFingering=()=>id==='clarinet'?new Set([...pressed].map(key=>clarinetFunctions.get(key)||key)):pressed;
  if(id==='clarinet')controls.append(buildClarinetViewControls(art.querySelector('.clarinet-diagram')));
  if(id==='flute'){const embouchure=art.querySelector('.embouchure');embouchure.setAttribute('role','button');embouchure.setAttribute('tabindex','0');embouchure.setAttribute('aria-label','Toggle flute high register');embouchure.addEventListener('click',()=>{highRegister=!highRegister;embouchure.classList.toggle('high-register',highRegister);embouchure.setAttribute('aria-pressed',String(highRegister));document.querySelector('#sound-caption').textContent=highRegister?'High register selected at the embouchure hole':'Middle register selected at the embouchure hole';playRecognizedFingering()});embouchure.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&!event.repeat){event.preventDefault();embouchure.click()}});}
  if(id==='clarinet'){
    const mouthpiece=art.querySelector('.clarinet-mouthpiece');let openVoice=null;
    mouthpiece.setAttribute('role','button');mouthpiece.setAttribute('tabindex','0');mouthpiece.setAttribute('aria-label','Hold the clarinet mouthpiece to play open written G4');mouthpiece.setAttribute('aria-pressed','false');
    const startOpen=event=>{if(pressed.size||openVoice)return;if(event){event.preventDefault();try{mouthpiece.setPointerCapture(event.pointerId)}catch{}}void ensureAudioReady();openVoice=playInstrumentNote('clarinet',midiForName('G4')-2,.24,'Open G4 · breath');mouthpiece.classList.add('mouthpiece-active');mouthpiece.setAttribute('aria-pressed','true');document.querySelector('#note-info').textContent=`Clarinet · Written G4 · concert ${pitchName(midiForName('G4')-2)} · open fingering`;if(practiceStatus&&practiceTarget==='G4'){practiceStatus.textContent='Correct · Written G4 · concert '+pitchName(midiForName('G4')-2);practiceStatus.classList.add('practice-success')}};
    const stopOpen=()=>{if(!openVoice)return;stopVoice(openVoice,false);openVoice=null;mouthpiece.classList.remove('mouthpiece-active');mouthpiece.setAttribute('aria-pressed','false')};stopOpenClarinet=stopOpen;
    mouthpiece.addEventListener('pointerdown',startOpen);mouthpiece.addEventListener('pointerup',stopOpen);mouthpiece.addEventListener('pointercancel',stopOpen);mouthpiece.addEventListener('lostpointercapture',stopOpen);mouthpiece.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.repeat){event.preventDefault();startOpen()}});mouthpiece.addEventListener('keyup',event=>{if(event.key==='Enter')stopOpen()});
  }  const heldInputs=new Map(),heldComputerKeys=new Map();
  const pressWindKey=(key,source)=>{if(id==='clarinet')void ensureAudioReady();const keyName=key.dataset.key,holders=heldInputs.get(keyName)||new Set();if(holders.has(source))return;holders.add(source);heldInputs.set(keyName,holders);if(pressed.has(keyName))return;pressed.add(keyName);if(id==='clarinet'&&keyName==='R'&&keyboardNote.code){updateWindDiagram(pressed);startNoteShortcut(keyboardNote.code);return}updateWindDiagram(pressed);playRecognizedFingering()};
  const releaseWindKey=(key,source)=>{const keyName=key.dataset.key,holders=heldInputs.get(keyName);if(!holders?.has(source))return;holders.delete(source);if(holders.size)return;heldInputs.delete(keyName);pressed.delete(keyName);if(id==='clarinet'&&keyName==='R'&&keyboardNote.code){updateWindDiagram(pressed);startNoteShortcut(keyboardNote.code);return}updateWindDiagram(pressed);if(id==='clarinet'&&pressed.size){playRecognizedFingering();return}stopInstrumentSounds(id,false,id==='clarinet'?.008:.11);for(const note of pendingNotes[id]||[])stopVoice(note,true);pendingNotes[id]=[];document.querySelector('#note-info').textContent=`${info[id].name} · Released · ${[...pressed].join(', ')||'all keys open'}`};
  clearWindControls=()=>{stopOpenClarinet();if(keyboardNote.voice)stopVoice(keyboardNote.voice,true);keyboardNote={code:null,label:null,voice:null};registerLatched=false;pressed.clear();heldInputs.clear();heldComputerKeys.clear();updateWindDiagram(pressed);stopInstrumentSounds(id,true);for(const note of pendingNotes[id]||[])stopVoice(note,true);pendingNotes[id]=[]};
  art.querySelectorAll('.wind-key[data-key]').forEach(key=>{
    key.setAttribute('role','button');key.setAttribute('tabindex','0');key.setAttribute('aria-pressed','false');key.setAttribute('aria-label',id==='clarinet'?`Press ${key.dataset.key} with ${key.dataset.finger||'the correct finger'}`:`Press flute key ${key.dataset.key}`);
    if(id==='clarinet'){
      key.addEventListener('pointerdown',event=>{event.preventDefault();pressWindKey(key,`pointer:${event.pointerId}`);try{key.setPointerCapture(event.pointerId)}catch{}});
      const releasePointer=event=>releaseWindKey(key,`pointer:${event.pointerId}`);
      key.addEventListener('pointerup',releasePointer);key.addEventListener('pointercancel',releasePointer);key.addEventListener('lostpointercapture',releasePointer);
      key.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&!event.repeat){event.preventDefault();pressWindKey(key,`keyboard:${event.key}`)}});
      key.addEventListener('keyup',event=>{if(event.key==='Enter'||event.key===' ')releaseWindKey(key,`keyboard:${event.key}`)});
    }else{
      key.addEventListener('click',()=>{const keyName=key.dataset.key;if(pressed.has(keyName))pressed.delete(keyName);else pressed.add(keyName);updateWindDiagram(pressed);playRecognizedFingering()});
      key.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&!event.repeat){event.preventDefault();key.click()}});
    }
  });
  if(id==='clarinet'){
    const isTypingTarget=target=>target instanceof Element&&!!target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]');
    const releaseActiveNote=code=>{
      if(keyboardNote.code!==code)return false;
      const oldVoice=keyboardNote.voice;keyboardNote={code:null,label:null,voice:null};if(oldVoice)stopVoice(oldVoice,false,.008);
      updateWindDiagram(pressed);
      if(pressed.size)playRecognizedFingering();
      else{stopInstrumentSounds('clarinet',false,.008);for(const note of pendingNotes.clarinet||[])stopVoice(note,true);pendingNotes.clarinet=[];document.querySelector('#note-info').textContent='Clarinet · Released';}
      return true;
    };
    startNoteShortcut=code=>{
      const baseLabel=clarinetNoteKeyboardMap[code];if(!baseLabel)return false;
      const naturalLabel=pressed.has('R')||registerLatched?baseLabel.replace(/4$/,'5'):baseLabel;
      const adjustment=clarinetAccidental==='sharp'?1:clarinetAccidental==='flat'?-1:0,writtenMidi=midiForName(naturalLabel)+adjustment;
      const symbol=clarinetAccidental==='sharp'?'♯':clarinetAccidental==='flat'?'♭':'';
      const label=`${naturalLabel[0]}${symbol}${naturalLabel.slice(1)}`;
      const chartLabel=Object.keys(fingeringMap).find(candidate=>midiForName(candidate)===writtenMidi);if(!chartLabel)return false;
      if(keyboardNote.code===code&&keyboardNote.label===label)return true;
      if(keyboardNote.voice)stopVoice(keyboardNote.voice,false,.001);
      const concertMidi=writtenMidi-2;keyboardNote={code,label,chartLabel,voice:null};selectedWrittenMidi=writtenMidi;
      updateWindDiagram(new Set(fingeringMap[chartLabel]||[]));keyboardNote.voice=playInstrumentNote('clarinet',concertMidi,.24,`Keyboard note · Written ${label}`);
      document.querySelector('#note-info').textContent=`Clarinet · Written ${label} · concert ${pitchName(concertMidi)} · keyboard note`;
      if(practiceStatus&&practiceTarget){const hit=midiForName(practiceTarget)===writtenMidi;practiceStatus.textContent=hit?`Correct · Written ${label} · concert ${pitchName(concertMidi)}`:`Detected ${label} · keep trying for ${practiceTarget}`;practiceStatus.classList.toggle('practice-success',hit)}
      return true;
    };
    releaseClarinetKeyboard=()=>{if(keyboardNote.voice)stopVoice(keyboardNote.voice,true);keyboardNote={code:null,label:null,voice:null};registerLatched=false;for(const [code,key] of [...heldComputerKeys])releaseWindKey(key,`computer:${code}`);heldComputerKeys.clear();updateWindDiagram(pressed)};
    clarinetKeyboardKeydown=event=>{
      if(player.classList.contains('hidden')||player.dataset.instrument!=='clarinet'||isTypingTarget(event.target)||event.ctrlKey||event.altKey||event.metaKey)return;
      if(event.code==='Space'){event.preventDefault();if(!event.repeat){stopPlayback();stopRhythmGame('Stopped');document.querySelector('#sound-caption').textContent='Playback stopped'}return}
      if(event.code==='BracketLeft'||event.code==='BracketRight'){event.preventDefault();if(!event.repeat)setAccidental(event.code==='BracketRight'?'sharp':'flat');return}
      if(clarinetNoteKeyboardMap[event.code]){event.preventDefault();if(!event.repeat)startNoteShortcut(event.code);return}
      const modelKey=clarinetKeyboardMap[event.code];if(!modelKey)return;event.preventDefault();if(event.repeat||heldComputerKeys.has(event.code))return;if(event.code==='KeyW')registerLatched=!registerLatched;
      const key=art.querySelector(`.clarinet-key[data-key="${modelKey}"]`);if(!key)return;heldComputerKeys.set(event.code,key);pressWindKey(key,`computer:${event.code}`);
    };
    clarinetKeyboardKeyup=event=>{if(player.dataset.instrument!=='clarinet')return;if(event.code==='Space'){event.preventDefault();return}if(keyboardNote.code===event.code){event.preventDefault();releaseActiveNote(event.code);return}const key=heldComputerKeys.get(event.code);if(!key||isTypingTarget(event.target))return;event.preventDefault();heldComputerKeys.delete(event.code);releaseWindKey(key,`computer:${event.code}`)};
  }  function playRecognizedFingering(){
    const soundingKeys=currentFingering();const matches=notes[id].filter(([label])=>fingeringMap[label]&&sameKeySet(soundingKeys,new Set(fingeringMap[label])));
    if(!matches.length){stopInstrumentSounds(id);for(const note of pendingNotes[id]||[])stopVoice(note,true);pendingNotes[id]=[];document.querySelector('#note-info').textContent=`${info[id].name} · ${pressed.size?'No mapped fingering':'All keys open'}`;return}
    const registerMatches=id==='flute'?matches.filter(candidate=>highRegister?candidate[1]>=84:candidate[1]<84):matches;const candidates=registerMatches.length?registerMatches:matches;const preferred=selectedWrittenMidi??(id==='flute'?(highRegister?84:72):60);const chosen=candidates.reduce((best,candidate)=>Math.abs(candidate[1]-preferred)<Math.abs(best[1]-preferred)?candidate:best,candidates[0]);
    selectedWrittenMidi=chosen[1];const soundingMidi=id==='clarinet'?chosen[1]-2:chosen[1];const label=id==='clarinet'?`Written ${chosen[0]} · concert ${pitchName(soundingMidi)}`:chosen[0];if(practiceStatus&&practiceTarget){const hit=chosen[0]===practiceTarget;practiceStatus.textContent=hit?`Correct · ${label}`:`Detected ${label} · keep trying for ${practiceTarget}`;practiceStatus.classList.toggle('practice-success',hit)}
    playInstrumentNote(id,soundingMidi,.24,`Fingering · ${[...pressed].join(', ')||'open'}`);document.querySelector('#note-info').textContent=`${info[id].name} · ${label} · ${[...pressed].join(', ')||'open'}`;
  }
  if(id==='clarinet'){
    const practice=document.createElement('section');practice.className='clarinet-practice';practice.setAttribute('aria-label','Clarinet fingering practice');
    const practiceHead=document.createElement('div');practiceHead.className='clarinet-practice-head';
    const practiceTitle=document.createElement('strong');practiceTitle.textContent='Fingering practice';
    practiceStatus=document.createElement('span');practiceStatus.className='clarinet-practice-status';practiceStatus.setAttribute('aria-live','polite');practiceStatus.textContent='Choose a practice note, then hold its keys together.';practiceHead.append(practiceTitle,practiceStatus);
    const practiceActions=document.createElement('div');practiceActions.className='clarinet-practice-actions';
    const guideButton=makeButton('Finger guide: on','clarinet-practice-button');guideButton.setAttribute('aria-pressed','true');
    const setTarget=label=>{practiceTarget=label;practiceStatus.textContent=`Play written ${label} · concert ${pitchName(midiForName(label)-2)}`;practiceStatus.classList.remove('practice-success');art.querySelectorAll('.clarinet-key').forEach(key=>key.classList.toggle('guide-key',fingerGuide&&(fingeringMap[label]||[]).includes(key.dataset.function||key.dataset.key)))};
    guideButton.addEventListener('click',()=>{fingerGuide=!fingerGuide;guideButton.textContent=`Finger guide: ${fingerGuide?'on':'off'}`;guideButton.setAttribute('aria-pressed',String(fingerGuide));art.querySelectorAll('.clarinet-key').forEach(key=>key.classList.toggle('guide-key',fingerGuide&&practiceTarget&&(fingeringMap[practiceTarget]||[]).includes(key.dataset.function||key.dataset.key)))});
    const newPractice=highOnly=>{const choices=notes.clarinet.filter(([label,midi])=>fingeringMap[label]&&(!highOnly||midi>=83));if(!choices.length)return;const choice=choices[Math.floor(Math.random()*choices.length)];setTarget(choice[0])};
    const practiceButton=makeButton('Practice a note','clarinet-practice-button');practiceButton.addEventListener('click',()=>newPractice(false));
    const highButton=makeButton('High-note practice','clarinet-practice-button');highButton.addEventListener('click',()=>newPractice(true));
    practiceActions.append(practiceButton,highButton,guideButton);
    const accidentalControls=document.createElement('div');accidentalControls.className='clarinet-accidental-controls';accidentalControls.setAttribute('aria-label','Note accidental controls');
    const accidentalLabel=document.createElement('span');accidentalLabel.className='clarinet-accidental-label';accidentalLabel.textContent='Note modifier';
    const sharpButton=makeButton('♯ Sharp','clarinet-accidental-button');sharpButton.setAttribute('aria-label','Toggle sharp notes');sharpButton.setAttribute('aria-pressed','false');
    const flatButton=makeButton('♭ Flat','clarinet-accidental-button');flatButton.setAttribute('aria-label','Toggle flat notes');flatButton.setAttribute('aria-pressed','false');
    setAccidental=mode=>{clarinetAccidental=clarinetAccidental===mode?'natural':mode;sharpButton.classList.toggle('active',clarinetAccidental==='sharp');flatButton.classList.toggle('active',clarinetAccidental==='flat');sharpButton.setAttribute('aria-pressed',String(clarinetAccidental==='sharp'));flatButton.setAttribute('aria-pressed',String(clarinetAccidental==='flat'));if(keyboardNote.code)startNoteShortcut(keyboardNote.code);else document.querySelector('#note-info').textContent=`Clarinet · ${clarinetAccidental==='natural'?'Natural notes':`${clarinetAccidental==='sharp'?'Sharp':'Flat'} mode selected`}`};
    sharpButton.addEventListener('click',()=>setAccidental('sharp'));flatButton.addEventListener('click',()=>setAccidental('flat'));accidentalControls.append(accidentalLabel,sharpButton,flatButton);
    const keyboardGuide=document.createElement('details');keyboardGuide.className='clarinet-keyboard-guide';const keyboardSummary=document.createElement('summary');keyboardSummary.textContent='Computer keyboard guide';keyboardGuide.append(keyboardSummary);
    const keyboardList=document.createElement('div');keyboardList.className='clarinet-keyboard-list';
    [['[','BracketLeft','flat'],[']','BracketRight','sharp']].forEach(([capText,,mode])=>{const row=document.createElement('div');row.className='clarinet-keyboard-row';const cap=document.createElement('kbd');cap.textContent=capText;const description=document.createElement('span');description.textContent=`Toggle ${mode}; press again for natural`;row.append(cap,description);keyboardList.append(row)});
    Object.entries(clarinetNoteKeyboardMap).forEach(([code,label])=>{const row=document.createElement('div');row.className='clarinet-keyboard-row';const cap=document.createElement('kbd');cap.textContent=code.replace(/^Key/,'');const description=document.createElement('span');description.textContent=`Play written ${label} · concert ${pitchName(midiForName(label)-2)}`;row.append(cap,description);keyboardList.append(row)});
    Object.entries(clarinetKeyboardMap).forEach(([code,modelKey])=>{const row=document.createElement('div');row.className='clarinet-keyboard-row';const cap=document.createElement('kbd');cap.textContent=code.replace(/^Key/,'');const key=art.querySelector(`.clarinet-key[data-key="${modelKey}"]`);const description=document.createElement('span');description.textContent=`${key?.dataset.finger||'Clarinet'} · ${modelKey}`;row.append(cap,description);keyboardList.append(row)});
    const stopRow=document.createElement('div');stopRow.className='clarinet-keyboard-row';const spaceCap=document.createElement('kbd');spaceCap.textContent='Space';const stopDescription=document.createElement('span');stopDescription.textContent='Stop all sound';stopRow.append(spaceCap,stopDescription);keyboardList.append(stopRow);keyboardGuide.append(keyboardList);
    const chart=document.createElement('details');chart.className='clarinet-chart';const summary=document.createElement('summary');summary.textContent='Fingering chart · written notes';chart.append(summary);
    const chartList=document.createElement('div');chartList.className='clarinet-chart-list';
    notes.clarinet.filter(([label])=>fingeringMap[label]).forEach(([label,midi])=>{const row=makeButton('','clarinet-chart-note');row.setAttribute('aria-label',`Show fingering for written ${label}, concert ${pitchName(midi-2)}`);const noteName=document.createElement('strong');noteName.textContent=label;const concertName=document.createElement('span');concertName.textContent=`Concert ${pitchName(midi-2)}`;const keyNames=document.createElement('small');keyNames.textContent=(fingeringMap[label].length?fingeringMap[label].join(' + '):'Open fingering · hold mouthpiece');row.append(noteName,concertName,keyNames);row.addEventListener('click',()=>setTarget(label));chartList.append(row)});
    const sourceNote=document.createElement('p');sourceNote.className='clarinet-chart-source';sourceNote.textContent='Boehm B♭ soprano clarinet · written E3–G6 · transposing pitch is written note down a major second. Core fingerings follow the Woodwind Fingering Guide.';chart.append(chartList,sourceNote);practice.append(practiceHead,practiceActions,accidentalControls,keyboardGuide,chart);controls.append(practice);
  }  const tip=document.createElement('p');tip.className='key-hint';tip.textContent=id==='clarinet'?'Use C–B for notes. Press [ for flat or ] for sharp; press the same key again for natural. W toggles the higher register.':'Tap the instrument keys to cover or uncover them; a matching fingering plays its note.';controls.append(tip);
}function buildDrums(){const kit=document.createElement('div');kit.className='drum-kit';[['Hi-hat','hat'],['Crash','crash'],['High tom','tomHigh'],['Mid tom','tomMid'],['Ride','ride'],['Snare','snare'],['Floor tom','tomLow'],['Bass','bass']].forEach(([label,part])=>{const b=makeButton(label,`drum ${part==='hat'?'hi-hat':part}`);wirePlay(b,()=>hitDrum(part));kit.appendChild(b)});controls.appendChild(kit)}
function choose(id){const current=info[id];if(!current)return;if(id==='guitar')selectedGuitarFrets.clear();if(id==='violin')selectedViolinNote=null;const previous=player.dataset.instrument;if(previous&&previous!==id)delete pendingNotes[previous];if(id!=='drums')pendingDrums.length=0;stopPlayback();void ensureAudioReady();chooser.classList.add('hidden');welcome.classList.add('hidden');player.classList.remove('hidden');player.dataset.instrument=id;document.querySelector('#instrument-title').textContent=current.name;document.querySelector('#instrument-icon').textContent=current.icon;document.querySelector('#instrument-icon').style.background=colors[id];document.querySelector('#sound-caption').textContent='Loading instrument samples…';document.querySelector('#note-info').textContent='Choose a control to see its note and fingering.';art.className=`instrument-art ${id}-art`;art.replaceChildren();controls.replaceChildren();if(id==='drums')buildDrums();else if(id==='piano')buildPiano();else if(current.kind==='strings')buildStrings(id);else buildWind(id);loadInstrument(id);window.scrollTo({top:0,behavior:'smooth'})}
document.querySelector('#start-button').addEventListener('click',()=>{void ensureAudioReady();welcome.classList.add('hidden');chooser.classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'})});
document.querySelectorAll('[data-instrument]').forEach(card=>card.addEventListener('click',()=>choose(card.dataset.instrument)));
document.querySelector('#back-button').addEventListener('click',()=>{stopPlayback();player.classList.add('hidden');player.removeAttribute('data-instrument');chooser.classList.remove('hidden');controls.replaceChildren();window.scrollTo({top:0,behavior:'smooth'})});
document.querySelector('#stop-sound').addEventListener('click',()=>{stopPlayback();stopRhythmGame('Stopped');document.querySelector('#sound-caption').textContent='Playback stopped';});
document.querySelector('#volume-slider').addEventListener('input',event=>{if(master)master.gain.setTargetAtTime(Number(event.target.value)/100,audio.currentTime,.025)});
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopRhythmGame('Paused');stopPlayback()}});
window.addEventListener('pagehide',()=>{stopRhythmGame('Stopped');stopPlayback()});
document.addEventListener('keydown',playFromComputerKey);
document.addEventListener('keydown',event=>clarinetKeyboardKeydown(event));
document.addEventListener('keyup',event=>clarinetKeyboardKeyup(event));
document.addEventListener('keyup',releasePianoComputerKey);
window.addEventListener('blur',()=>{if(player.dataset.instrument==='clarinet')clearWindControls();releaseClarinetKeyboard();stopRhythmGame('Paused');for(const control of [...activeControls])releaseControl(control);for(const voice of heldPianoKeys.values())if(voice)stopVoice(voice);heldPianoKeys.clear()});

// Original rhythm-game patterns. Notes are fixed lane numbers, never randomized.
const practiceSongs=[
  {id:'easy',name:'First Steps',bpm:72,difficulty:'Easy',step:.5,pattern:[0,null,1,null,2,null,4,null,2,null,1,null,0,null,4,null,3,null,2,null,1,null,0,null,2,null,4,null,2,null,0,null]},
  {id:'medium',name:'Bright Window',bpm:100,difficulty:'Medium',step:.5,pattern:[0,2,4,null,2,4,5,null,4,2,1,null,0,1,2,null,4,5,6,null,5,4,2,null,1,2,4,null,2,1,0,null]},
  {id:'hard',name:'Quicksilver',bpm:132,difficulty:'Hard',step:.5,pattern:[[0,4],2,1,3,4,2,5,1,[0,4],3,2,5,6,4,2,1,[1,5],3,4,2,0,2,4,6,[0,4],1,3,5,4,2,0,1]}
];
const rhythmPicker=document.querySelector('#song-picker'),rhythmPanel=document.querySelector('#rhythm-game'),rhythmLaunch=document.querySelector('#rhythm-launch');
let selectedSong=null,rhythmState=null,rhythmRaf=0,rhythmStartToken=0;
const rhythmPitchLanes={
  piano:[60,62,64,65,67,69,71],guitar:[60,62,64,65,67,69,71],
  violin:[55,57,59,60,62,64,67],
  flute:[72,74,76,77,79,81,83],clarinet:[58,60,62,63,65,67,69]
};
const drumLanes=[['bass','Bass'],['snare','Snare'],['hat','Hi-hat'],['tomHigh','High tom'],['crash','Crash']];
function buildSongPicker(){
  const list=document.querySelector('#song-list');list.replaceChildren();
  practiceSongs.forEach(song=>{const card=document.createElement('button');card.type='button';card.className='song-card';card.innerHTML=`<strong>${song.name}</strong><span>${song.bpm} BPM · ${song.difficulty}</span>`;card.addEventListener('click',()=>{selectedSong=song;list.querySelectorAll('.song-card').forEach(el=>el.classList.toggle('selected',el===card));document.querySelector('#song-start').disabled=false});list.append(card)});
}
function visiblePlayableNotes(instrument){
  if(instrument==='piano')return notes.piano.map(row=>row[2]);
  if(instrument==='guitar')return notes.guitar.flatMap(([label,base])=>Array.from({length:25},(_,fret)=>Math.round(69+12*Math.log2(base/440))+fret));
  if(instrument==='violin')return notes.violin.flatMap(([label,base])=>{const root=Math.round(69+12*Math.log2(base/440));return [root,...violinPositionStarts.flatMap(start=>violinFingerOffsets.map(offset=>root+start+offset))]});
  if(instrument==='flute')return notes.flute.map(row=>row[1]);
  if(instrument==='clarinet')return notes.clarinet.map(row=>row[1]-2);
  return [];
}
function lanePitches(instrument){
  if(instrument==='drums')return drumLanes.map(([part,label])=>({part,label}));
  const supported=new Set(visiblePlayableNotes(instrument));
  const preferred=rhythmPitchLanes[instrument];
  const lanes=preferred.filter(midi=>supported.has(midi));
  return lanes.length>=3?lanes:preferred;
}
async function startRhythmGame(){
  if(!selectedSong)return;stopRhythmGame('');stopPlayback();const instrument=player.dataset.instrument;if(!instrument)return;const startToken=++rhythmStartToken,startButton=document.querySelector('#song-start');startButton.disabled=true;document.querySelector('#sound-caption').textContent='Loading sounds for the song…';await loadInstrument(instrument);if(startToken!==rhythmStartToken||player.dataset.instrument!==instrument){startButton.disabled=false;return;}startButton.disabled=false;await audio?.resume();

  const lanes=lanePitches(instrument),events=[];let ordinal=0;
  selectedSong.pattern.forEach((value,index)=>{if(value===null)return;const laneValues=Array.isArray(value)?value:[value];(monophonicInstruments.has(instrument)?laneValues.slice(0,1):laneValues).forEach(lane=>{const laneIndex=lane%lanes.length;events.push({id:ordinal++,lane:laneIndex,beat:index*selectedSong.step,hit:false,missed:false,el:null})})});
  const startAt=performance.now()+1400;
  rhythmState={instrument,lanes,events,startAt,pausedAt:null,score:0,combo:0,hits:0,misses:0,judged:0,lastTime:0};
  document.querySelector('#game-song-title').textContent=selectedSong.name;
  document.querySelector('#game-tempo').textContent=`${selectedSong.bpm} BPM · ${selectedSong.difficulty}`;
  document.querySelector('#game-score').textContent='0';document.querySelector('#game-combo').textContent='0';document.querySelector('#game-misses').textContent='0';document.querySelector('#game-accuracy').textContent='—';document.querySelector('#game-feedback').textContent='Get ready';
  document.querySelector('#game-pause').textContent='Pause';document.querySelector('#song-progress').value=0;document.querySelector('#progress-label').textContent='0%';
  const track=document.querySelector('#note-track'),laneBox=document.querySelector('#game-lanes');track.style.setProperty('--lanes',lanes.length);laneBox.style.setProperty('--lanes',lanes.length);track.querySelectorAll('.falling-note').forEach(el=>el.remove());laneBox.replaceChildren();
  lanes.forEach((lane,index)=>{const button=document.createElement('button');button.type='button';button.className='game-lane';button.textContent=instrument==='drums'?lane.label:(instrument==='clarinet'?`${pitchName(lane)} / ${pitchName(lane+2)} written` :pitchName(lane));button.setAttribute('aria-label',instrument==='drums'?`Play ${lane.label}`:`Play ${pitchName(lane)}`);wirePlay(button,()=>{if(instrument==='drums')return playDrum(lane.part);return playInstrumentNote(instrument,lane,.24,'Rhythm lane')});laneBox.append(button)});
  const names=lanes.map((lane,i)=>`${i+1}=${instrument==='drums'?lane.label:pitchName(lane)}`).join(' · ');document.querySelector('#game-key-hint').textContent=`Keyboard lanes: ${names}`;
  rhythmPicker.classList.add('hidden');rhythmPanel.classList.remove('hidden');rhythmLaunch.classList.add('hidden');document.querySelector('#stage').classList.add('rhythm-active');
  rhythmState.events.forEach(event=>{const note=document.createElement('span');note.className=`falling-note${instrument==='drums'?' drum-note':''}`;note.style.left=`${(event.lane+.5)*100/lanes.length}%`;note.setAttribute('aria-hidden','true');event.el=note;track.append(note)});
  rhythmRaf=requestAnimationFrame(renderRhythmFrame);
}
function rhythmNow(now){return rhythmState.pausedAt!==null?rhythmState.pausedAt-rhythmState.startAt:now-rhythmState.startAt}
function renderRhythmFrame(now){
  if(!rhythmState)return;const state=rhythmState,elapsed=rhythmNow(now),track=document.querySelector('#note-track'),height=track.clientHeight,hitY=height-27,approach=1900,secondsPerBeat=60/selectedSong.bpm,totalBeats=selectedSong.pattern.length*selectedSong.step;
  state.events=state.events.filter(event=>{const hitAt=event.beat*secondsPerBeat*1000;if(elapsed>hitAt+165){event.el?.remove();state.misses++;state.combo=0;state.judged++;document.querySelector('#game-feedback').textContent='Miss';updateRhythmStats();return false}const y=hitY-((hitAt-elapsed)/approach)*hitY;event.el.style.top=`${Math.max(-20,Math.min(height+20,y))}px`;event.el.style.opacity=(y< -10||y>height+10)?'0':'1';event.el.classList.toggle('near-hit',Math.abs(hitAt-elapsed)<100);return true});
  const progress=Math.max(0,Math.min(100,elapsed/(totalBeats*secondsPerBeat*1000)*100));document.querySelector('#song-progress').value=progress;document.querySelector('#progress-label').textContent=`${Math.round(progress)}%`;
  if(elapsed>(totalBeats*secondsPerBeat*1000)+250){finishRhythmGame('Song complete');return}
  rhythmRaf=requestAnimationFrame(renderRhythmFrame);
}
function updateRhythmStats(){if(!rhythmState)return;document.querySelector('#game-score').textContent=String(rhythmState.score);document.querySelector('#game-combo').textContent=String(rhythmState.combo);document.querySelector('#game-misses').textContent=String(rhythmState.misses);document.querySelector('#game-accuracy').textContent=rhythmState.judged?`${Math.round(rhythmState.hits/rhythmState.judged*100)}%`:'—'}
function judgeRhythmInput(instrument,midi,drumPart=null){
  const state=rhythmState;if(!state||state.instrument!==instrument||state.pausedAt!==null)return;
  const now=performance.now(),elapsed=now-state.startAt,windowMs=165;const candidate=state.events.filter(event=>!event.hit&&!event.missed&&Math.abs(event.beat*60/selectedSong.bpm*1000-elapsed)<=windowMs&&((instrument==='drums'&&state.lanes[event.lane].part===drumPart)||(instrument!=='drums'&&state.lanes[event.lane]===midi))).sort((a,b)=>Math.abs(a.beat*60/selectedSong.bpm*1000-elapsed)-Math.abs(b.beat*60/selectedSong.bpm*1000-elapsed))[0];
  if(!candidate){document.querySelector('#game-feedback').textContent='Try again';state.combo=0;updateRhythmStats();return}
  const error=Math.abs(candidate.beat*60/selectedSong.bpm*1000-elapsed);candidate.hit=true;candidate.el?.remove();state.events.splice(state.events.indexOf(candidate),1);state.judged++;state.hits++;state.combo++;state.score+=(error<=65?300:150)+Math.min(state.combo,50)*5;document.querySelector('#game-feedback').textContent=error<=65?'Perfect':'Good';document.querySelectorAll('.game-lane')[candidate.lane]?.classList.add('playing');window.setTimeout(()=>document.querySelectorAll('.game-lane')[candidate.lane]?.classList.remove('playing'),130);updateRhythmStats();
}
function finishRhythmGame(message){if(!rhythmState)return;cancelAnimationFrame(rhythmRaf);rhythmRaf=0;rhythmState=null;stopPlayback();document.querySelector('#game-feedback').textContent=message;document.querySelector('#game-pause').textContent='Pause';}
function stopRhythmGame(message='Stopped'){rhythmStartToken++;if(!rhythmState)return;finishRhythmGame(message)}
function toggleRhythmPause(){if(!rhythmState)return;const state=rhythmState,now=performance.now();if(state.pausedAt===null){state.pausedAt=now;cancelAnimationFrame(rhythmRaf);stopPlayback();audio?.suspend();document.querySelector('#game-pause').textContent='Resume';document.querySelector('#game-feedback').textContent='Paused'}else{state.startAt+=now-state.pausedAt;state.pausedAt=null;audio?.resume();document.querySelector('#game-pause').textContent='Pause';document.querySelector('#game-feedback').textContent='Playing';rhythmRaf=requestAnimationFrame(renderRhythmFrame)}}
function exitRhythmGame(toSongs=true){stopRhythmGame('');rhythmPanel.classList.add('hidden');document.querySelector('#stage').classList.remove('rhythm-active');if(toSongs)rhythmPicker.classList.remove('hidden');else rhythmLaunch.classList.remove('hidden');}
buildSongPicker();
rhythmLaunch.addEventListener('click',()=>{rhythmPicker.classList.remove('hidden');rhythmLaunch.classList.add('hidden');document.querySelector('#stage').classList.add('rhythm-active')});
document.querySelector('#song-back').addEventListener('click',()=>{rhythmStartToken++;rhythmPicker.classList.add('hidden');rhythmLaunch.classList.remove('hidden');document.querySelector('#stage').classList.remove('rhythm-active')});
document.querySelector('#song-start').addEventListener('click',startRhythmGame);
document.querySelector('#game-back').addEventListener('click',()=>exitRhythmGame(true));
document.querySelector('#game-pause').addEventListener('click',toggleRhythmPause);
document.querySelector('#game-restart').addEventListener('click',startRhythmGame);
document.querySelector('#game-stop').addEventListener('click',()=>{stopPlayback();stopRhythmGame('Stopped')});
document.querySelector('#back-button').addEventListener('click',()=>exitRhythmGame(false));
document.addEventListener('keydown',event=>{if(!rhythmState||event.repeat||event.ctrlKey||event.altKey||event.metaKey)return;const index=Number(event.key)-1;if(!Number.isInteger(index)||index<0||index>=rhythmState.lanes.length)return;event.preventDefault();const lane=rhythmState.lanes[index];if(rhythmState.instrument==='drums')playDrum(lane.part);else playInstrumentNote(rhythmState.instrument,lane,.24,'Rhythm key '+event.key)});

