const chooser=document.querySelector('#chooser');
const welcome=document.querySelector('#welcome');
const player=document.querySelector('#player');
const controls=document.querySelector('#controls');
const art=document.querySelector('#instrument-art');
const audioContext=window.AudioContext||window.webkitAudioContext;
let audio=null,master=null,limiter=null,nextStickingHand='R';
const activeSources=new Set(),activeVoices=new Set(),instrumentVoices=new Map();
const activeControls=new Set(),controlHeld=new WeakMap(),heldPianoKeys=new Map(),selectedGuitarFrets=new Map(),selectedViolinNotes=new Map();let clearWindControls=()=>{};
const monophonicInstruments=new Set(['flute','clarinet']);
const violinPositionStarts=[2,3,5,7,9,10,12,14,15,17,19,21],violinFingerOffsets=[0,2,3,5];
const pitchName=midi=>`${['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][midi%12]}${Math.floor(midi/12)-1}`;
const frequency=midi=>440*2**((midi-69)/12);
const sampleCache=new Map(),instrumentBuffers={},loadPromises={},pendingNotes={},pendingDrums=[],loadingInstruments=new Set();
const sampleAnchors={
  piano:Array.from({length:8},(_,oct)=>[21+oct*12,24+oct*12,27+oct*12,30+oct*12]).flat().concat(108).filter(midi=>midi<=108),
  guitar:[38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,64,65,66,67,68,69,70,71,72,73,74,76,77,79],
  violin:[55,57,60,64,67,69,72,76,79,81,84,88,91,93,96],
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
  hatOpen:'https://raw.githubusercontent.com/octalmusic/octal-samples/main/samples/hats/open-01.wav',
  snareSnap:'https://raw.githubusercontent.com/octalmusic/octal-samples/main/samples/snares/snap-01.wav',
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
    if(immediate){voice.gain.gain.setValueAtTime(0,now);(voice.sources||[voice.source]).forEach(source=>{try{source.stop(now)}catch{}})}
    else{voice.gain.gain.linearRampToValueAtTime(0,now+fadeTime);(voice.sources||[voice.source]).forEach(source=>{try{source.stop(now+fadeTime+.005)}catch{}})}
  }catch{for(const source of voice.sources||[voice.source])try{source.stop()}catch{}}
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
  const pending=pendingNotes[instrument];if(!pending?.length||loadingInstruments.has(instrument))return;delete pendingNotes[instrument];for(const note of pending)if(!note.stopped)note.actual=playInstrumentNote(instrument,note.midi,note.level,note.control,false);
}async function loadInstrument(instrument){
  if(loadPromises[instrument])return loadPromises[instrument];
  loadPromises[instrument]=(async()=>{
    await ensureAudioReady();
    const anchors=instrument==='drums'?Object.entries(drumUrls).map(([part,url])=>[part,url]):sampleAnchors[instrument].map(midi=>[midi,urlForNote(instrument,midi)]);
    const buffers=new Map();loadingInstruments.add(instrument);if(instrument==='clarinet')instrumentBuffers[instrument]=buffers;
    const loaded=await Promise.allSettled(anchors.map(async([key,url])=>{const buffer=await loadBuffer(url);if(instrument!=='drums'){buffers.set(key,buffer);if(instrument==='clarinet')flushPendingNotes(instrument)}return [key,buffer]}));
    let failed=0;loaded.forEach(result=>{if(result.status==='fulfilled'){if(instrument==='drums')buffers.set(...result.value)}else{failed++;console.warn('Instrument sample unavailable',result.reason)}});
    loadingInstruments.delete(instrument);instrumentBuffers[instrument]=buffers;
    if(player.dataset.instrument===instrument){document.querySelector('#sound-caption').textContent=failed?`${info[instrument].caption} · built-in ${instrument} sound fills missing samples`:'Instrument sounds ready';if(failed)setAudioStatus('fallback','Audio enabled · backup instrument sound active')}
    if(instrument!=='drums')flushPendingNotes(instrument);
    if(instrument==='drums'&&player.dataset.instrument==='drums')pendingDrums.splice(0).forEach(part=>playDrum(part,false));
    return buffers;
  })();
  return loadPromises[instrument];
}
function nearestAnchor(instrument,midi){const loaded=instrumentBuffers[instrument];const available=loaded?.size?sampleAnchors[instrument].filter(candidate=>loaded.has(candidate)):sampleAnchors[instrument];return available.reduce((best,candidate)=>Math.abs(candidate-midi)<Math.abs(best-midi)?candidate:best,available[0])}
function playBuffer(buffer,rate=1,level=.24,instrument=null,startAt=null){
  const ctx=initAudio();if(!ctx||!buffer)return null;
  const source=track(ctx.createBufferSource(),instrument),gain=ctx.createGain(),toneNodes=[];source.buffer=buffer;source.playbackRate.value=rate;gain.gain.value=level*(instrument==='clarinet'?1.5:1);source.connect(gain);
  if(instrument==='clarinet'){
    const body=ctx.createBiquadFilter();body.type='lowshelf';body.frequency.value=250;body.gain.value=4.5;
    const core=ctx.createBiquadFilter();core.type='peaking';core.frequency.value=900;core.Q.value=.75;core.gain.value=2.5;
    const air=ctx.createBiquadFilter();air.type='highshelf';air.frequency.value=2000;air.gain.value=-12;
    const rolloff=ctx.createBiquadFilter();rolloff.type='lowpass';rolloff.frequency.value=3300;rolloff.Q.value=.72;
    gain.connect(body);body.connect(core);core.connect(air);air.connect(rolloff);rolloff.connect(master);toneNodes.push(body,core,air,rolloff);
  }else gain.connect(master);
  const voice={source,gain,instrument,toneNodes,stopped:false};activeVoices.add(voice);
  if(instrument){if(!instrumentVoices.has(instrument))instrumentVoices.set(instrument,new Set());instrumentVoices.get(instrument).add(voice)}
  source.addEventListener('ended',()=>{activeVoices.delete(voice);instrumentVoices.get(instrument)?.delete(voice);try{source.disconnect();gain.disconnect();toneNodes.forEach(node=>node.disconnect())}catch{}},{once:true});source.start(startAt===null?ctx.currentTime:startAt);return voice;
}
const fallbackHarmonics={piano:[1,.56,.34,.22,.15,.1,.07,.05,.035],guitar:[1,.72,.48,.32,.22,.15,.1,.065,.04],violin:[1,.78,.62,.48,.38,.29,.22,.17,.12,.09],flute:[1,.08,.28,.035,.12,.02,.06,.012],clarinet:[1,0,.7,0,.43,0,.27,0,.17,0,.1]};
function registerFallbackVoice(sources,gain,instrument,toneNodes=[]){
  const voice={source:sources[0],sources,gain,instrument,toneNodes,stopped:false};activeVoices.add(voice);if(instrument){if(!instrumentVoices.has(instrument))instrumentVoices.set(instrument,new Set());instrumentVoices.get(instrument).add(voice)}let remaining=sources.length;const cleanup=()=>{if(--remaining>0)return;activeVoices.delete(voice);instrumentVoices.get(instrument)?.delete(voice);try{gain.disconnect();toneNodes.forEach(node=>node.disconnect())}catch{}};sources.forEach(source=>{track(source,instrument);source.addEventListener('ended',cleanup,{once:true})});return voice;
}
function playFallbackNote(instrument,midi,level=.24,duration=null){
  const ctx=initAudio();if(!ctx||!master)return null;const partials=fallbackHarmonics[instrument]||fallbackHarmonics.piano,real=new Float32Array(partials.length+1),imag=new Float32Array(partials.length+1);partials.forEach((amplitude,index)=>{imag[index+1]=amplitude});const wave=ctx.createPeriodicWave(real,imag),oscillator=ctx.createOscillator(),filter=ctx.createBiquadFilter(),envelope=ctx.createGain(),now=ctx.currentTime,attack={piano:.006,guitar:.008,violin:.035,flute:.06,clarinet:.025}[instrument]||.02;oscillator.setPeriodicWave(wave);oscillator.frequency.setValueAtTime(frequency(midi),now);filter.type='lowpass';filter.frequency.value={piano:7600,guitar:5200,violin:6200,flute:7200,clarinet:4300}[instrument]||6000;filter.Q.value=.45;oscillator.connect(filter);filter.connect(envelope);envelope.connect(master);const peak=level*(instrument==='clarinet'?.72:.62);envelope.gain.setValueAtTime(.0001,now);envelope.gain.linearRampToValueAtTime(peak,now+attack);if(instrument==='piano'||instrument==='guitar')envelope.gain.setTargetAtTime(peak*(instrument==='piano'?.38:.2),now+attack+.08,instrument==='piano'?.65:.34);oscillator.start(now);const voice=registerFallbackVoice([oscillator],envelope,instrument,[filter]);if(duration)window.setTimeout(()=>stopVoice(voice,false,.12),duration*1000);return voice;
}
function playFallbackDrum(part,level=.38){
  const ctx=initAudio();if(!ctx||!master)return null;const now=ctx.currentTime,duration=part==='crash'?.9:part==='ride'?.55:part==='hatOpen'?.42:part==='hat'?.12:part==='snareSnap'?.16:part==='snare'?.25:.38,envelope=ctx.createGain(),sources=[],nodes=[];envelope.gain.setValueAtTime(.0001,now);envelope.gain.linearRampToValueAtTime(part==='hat'?level*.58:level,now+.004);envelope.gain.exponentialRampToValueAtTime(.0001,now+duration);envelope.connect(master);
  if(part==='bass'||part.startsWith('tom')){const osc=ctx.createOscillator(),startHz=part==='bass'?145:part==='tomHigh'?245:part==='tomMid'?185:135,endHz=part==='bass'?48:startHz*.58;osc.type=part==='bass'?'sine':'triangle';osc.frequency.setValueAtTime(startHz,now);osc.frequency.exponentialRampToValueAtTime(endHz,now+Math.min(.16,duration*.65));osc.connect(envelope);osc.start(now);osc.stop(now+duration);sources.push(osc)}else{const buffer=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*duration),ctx.sampleRate),data=buffer.getChannelData(0);for(let index=0;index<data.length;index++)data[index]=Math.random()*2-1;const noise=ctx.createBufferSource(),filter=ctx.createBiquadFilter();noise.buffer=buffer;filter.type=part==='snare'||part==='snareSnap'?'bandpass':'highpass';filter.frequency.value=part==='hat'?7200:part==='hatOpen'?5400:part==='ride'?3100:part==='crash'?2200:1900;filter.Q.value=part==='snare'||part==='snareSnap'?0.8:.5;noise.connect(filter);filter.connect(envelope);noise.start(now);noise.stop(now+duration);sources.push(noise);nodes.push(filter);if(part==='snare'||part==='snareSnap'){const body=ctx.createOscillator(),bodyGain=ctx.createGain();body.type='triangle';body.frequency.setValueAtTime(part==='snare'?190:240,now);bodyGain.gain.setValueAtTime(.12,now);bodyGain.gain.exponentialRampToValueAtTime(.0001,now+duration*.65);body.connect(bodyGain);bodyGain.connect(envelope);body.start(now);body.stop(now+duration);sources.push(body);nodes.push(bodyGain)}}
  const voice=registerFallbackVoice(sources,envelope,'drums',nodes);sources.forEach(source=>source.addEventListener('ended',()=>{try{source.disconnect()}catch{}},{once:true}));return voice;
}
function playBackingNote(instrument,midi,duration){
  const buffers=instrumentBuffers[instrument],anchor=buffers?.size?nearestAnchor(instrument,midi):null,buffer=anchor===null?null:buffers.get(anchor);let voice=buffer?playBuffer(buffer,2**((midi-anchor)/12),.085,instrument):playFallbackNote(instrument,midi,.13,duration);if(voice&&buffer)window.setTimeout(()=>stopVoice(voice,false,.14),duration*1000);return voice;
}
function playBackingDrum(part){const buffer=instrumentBuffers.drums?.get(part);return buffer?playBuffer(buffer,1,.16):playFallbackDrum(part,.18)}
function playSongBacking(state,event){
  if(state.instrument==='drums'){event.parts.forEach(playBackingDrum);return}const shift={piano:-12,guitar:-12,violin:-5,flute:0,clarinet:-12}[state.instrument]||0,root=event.root+shift,duration=Math.min(2.4,60/state.bpm*3.65),tones=monophonicInstruments.has(state.instrument)?[root]:[root,root+4,root+7];tones.forEach(midi=>playBackingNote(state.instrument,midi,duration));
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
  if(judge)recordPlayerAction(instrument);
  if(judge)judgeRhythmInput(instrument,targetMidi);
  const monophonic=monophonicInstruments.has(instrument);
  if(monophonic){stopInstrumentSounds(instrument,instrument==='clarinet'?false:true,instrument==='clarinet' ? .001 : .11);for(const note of pendingNotes[instrument]||[])stopVoice(note,true);pendingNotes[instrument]=[]}
  showNoteInfo(instrument,targetMidi,control||`Note ${instrument==='clarinet'?pitchName(targetMidi+2):pitchName(targetMidi)}`);
  const finishRhythmVoice=voice=>{const state=rhythmState;if(voice&&state?.instrument===instrument){const duration=(state.stepBeats||.5)*60/(state.bpm||selectedSong?.bpm||120)*.9;window.setTimeout(()=>stopVoice(voice),duration*1000)}return voice};
  const buffers=instrumentBuffers[instrument];
  if(!buffers?.size){document.querySelector('#sound-caption').textContent=`${info[instrument].caption} · built-in ${instrument} sound`;return finishRhythmVoice(playFallbackNote(instrument,targetMidi,level))}
  const anchor=nearestAnchor(instrument,targetMidi);if(instrument==='clarinet'&&Math.abs(targetMidi-anchor)>3){document.querySelector('#sound-caption').textContent=`Using built-in clarinet tone for ${pitchName(targetMidi)}`;return finishRhythmVoice(playFallbackNote(instrument,targetMidi,level))}const buffer=buffers.get(anchor);
  if(!buffer){document.querySelector('#sound-caption').textContent=`Using built-in ${instrument} sound for ${pitchName(targetMidi)}`;return finishRhythmVoice(playFallbackNote(instrument,targetMidi,level))}
  return finishRhythmVoice(playBuffer(buffer,2**((targetMidi-anchor)/12),level,instrument));
}function playDrum(part,judge=true){
  if(judge)recordPlayerAction('drums');
  if(judge)judgeRhythmInput('drums',null,part);
  const drumLabel=part==='hat'?'Closed hi-hat':part==='hatOpen'?'Open hi-hat':part==='bass'?'Bass drum':part==='snare'?'Snare':part==='snareSnap'?'Snare snap':part.replace(/([A-Z])/g,' $1');
  const sticking=part==='bass'?'Foot':part==='hat'||part==='hatOpen'?'Right hand or foot':nextStickingHand==='R'?'Right hand':'Left hand';
  if(part!=='bass'&&part!=='hat'&&part!=='hatOpen')nextStickingHand=nextStickingHand==='R'?'L':'R';
  document.querySelector('#note-info').textContent=`Drums · ${drumLabel} · percussion pad · Suggested: ${sticking}`;
  const buffers=instrumentBuffers.drums;if(!buffers?.size){document.querySelector('#sound-caption').textContent='Drum samples loading · built-in percussion sound active';return playFallbackDrum(part)}
  const buffer=buffers.get(part);if(!buffer){document.querySelector('#sound-caption').textContent=`Built-in percussion sound active for ${drumLabel}`;return playFallbackDrum(part)}
  return playBuffer(buffer,1,.32);
}function hitDrum(part){return playDrum(part)}
function flash(button){button.classList.add('playing');window.setTimeout(()=>button.classList.remove('playing'),260)}
function makeButton(label,cls=''){const b=document.createElement('button');b.type='button';b.className=cls;b.textContent=label;b.setAttribute('aria-label',`Play ${label}`);return b}
function releaseControl(button,immediate=false,force=false){
  const held=controlHeld.get(button);if(!held)return;
  if(!force&&!immediate&&held.release&&held.minHoldMs>0&&!held.releaseRequested){const remaining=held.minHoldMs-(performance.now()-held.startedAt);if(remaining>0){held.releaseRequested=true;controlHeld.delete(button);activeControls.delete(button);button.classList.remove('playing');held.releaseTimer=window.setTimeout(()=>{if(held.voice)stopVoice(held.voice,immediate)},remaining);return}}
  if(held.releaseTimer)window.clearTimeout(held.releaseTimer);controlHeld.delete(button);activeControls.delete(button);button.classList.remove('playing');
  if(held.release&&held.voice){if(Array.isArray(held.voice))held.voice.forEach(voice=>stopVoice(voice,immediate));else stopVoice(held.voice,immediate)}
}
function wirePlay(button,callback,{release=false,minHoldMs=0}={}){
  const press=event=>{if(event)event.preventDefault();if(controlHeld.has(button))return;const voice=callback(event);controlHeld.set(button,{voice,release,minHoldMs,startedAt:performance.now(),releaseRequested:false,releaseTimer:0});activeControls.add(button);button.classList.add('playing');if(!release&&voice?.source)voice.source.addEventListener('ended',()=>releaseControl(button),{once:true});};
  button.addEventListener('pointerdown',event=>{press(event);try{button.setPointerCapture(event.pointerId)}catch{}});
  button.addEventListener('pointerup',()=>releaseControl(button));button.addEventListener('pointercancel',()=>releaseControl(button));button.addEventListener('lostpointercapture',()=>releaseControl(button));
  button.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&!event.repeat)press(event)});
  button.addEventListener('keyup',event=>{if(event.key==='Enter'||event.key===' ')releaseControl(button)});
}function buildPiano(){
  const keys=document.createElement('div');keys.className='keys';const white=notes.piano.filter(([, ,m])=>![1,3,6,8,10].includes(m%12)),black=notes.piano.filter(([, ,m])=>[1,3,6,8,10].includes(m%12));
  controls.appendChild(keys);
  const whiteWidth=parseFloat(getComputedStyle(keys).getPropertyValue('--white-key-width'))||28,blackWidth=parseFloat(getComputedStyle(keys).getPropertyValue('--black-key-width'))||18;
  const positions=new Map();white.forEach(([label,,midi],i)=>positions.set(midi,i));
  white.forEach(([label,,midi])=>{const b=makeButton(midi%12===0?label:'','white-key');b.setAttribute('aria-label',`Play ${label}`);b.title=label;wirePlay(b,()=>playInstrumentNote('piano',midi,.24,'Piano key'),{release:true});keys.appendChild(b)});
  black.forEach(([label,,midi])=>{const b=makeButton('','black-key');b.style.left=`${(positions.get(midi-1)+1)*whiteWidth-blackWidth/2}px`;b.setAttribute('aria-label',`Play ${label}`);b.title=label;wirePlay(b,()=>playInstrumentNote('piano',midi,.24,'Piano key'),{release:true});keys.appendChild(b)});
  const hint=document.createElement('p');hint.className='key-hint';hint.textContent='Full 88-key range · scroll to explore';
  controls.append(keys,hint);window.requestAnimationFrame(()=>{if(keys.scrollWidth>controls.clientWidth*1.7){const middleC=keys.querySelector('[aria-label="Play C4"]');if(middleC)controls.scrollLeft=Math.max(0,middleC.offsetLeft+middleC.offsetWidth/2-controls.clientWidth/2)}});
}
// C–B are note shortcuts (written C4–B4); the remaining keys operate the
// clarinet's physical controls. T is the left-thumb hole key.
const clarinetNoteKeyboardMap=Object.freeze({KeyC:'C4',KeyD:'D4',KeyE:'E4',KeyF:'F4',KeyG:'G4',KeyA:'A4',KeyB:'B4'});
const fluteNoteKeyboardMap=Object.freeze({KeyC:'C5',KeyD:'D5',KeyE:'E5',KeyF:'F5',KeyG:'G5',KeyA:'A5',KeyB:'B5'});
const clarinetKeyboardMap=Object.freeze({KeyT:'T',KeyW:'R',KeyQ:'L1',KeyS:'L2',KeyH:'L3',KeyN:'R1',KeyM:'R2',KeyV:'R3',KeyJ:'A',KeyK:'G#-side',KeyX:'Eb',KeyU:'E/B-L',KeyI:'F-R',KeyO:'F#-R',KeyP:'C#-L',KeyR:'G#-L',KeyY:'B'});
const clarinetComputerKeyByModelKey=Object.fromEntries(Object.entries(clarinetKeyboardMap).map(([code,modelKey])=>[modelKey,code.replace(/^Key/,'')]));
let clarinetKeyboardKeydown=()=>{},clarinetKeyboardKeyup=()=>{},releaseClarinetKeyboard=()=>{};let fluteKeyboardKeydown=()=>{},fluteKeyboardKeyup=()=>{},releaseFluteKeyboard=()=>{};const pianoKeyMap={z:48,s:49,x:50,d:51,c:52,v:53,g:54,b:55,h:56,n:57,j:58,m:59,',':60,l:61,'.':62,';':63,'/':64,q:60,2:61,w:62,3:63,e:64,r:65,5:66,t:67,6:68,y:69,7:70,u:71,i:72,9:73,o:74,0:75,p:76};
function playFromComputerKey(event){
  if(player.classList.contains('hidden')||player.dataset.instrument!=='piano'||event.repeat||event.ctrlKey||event.altKey||event.metaKey)return;
  const keyName=event.key.toLowerCase(),midi=pianoKeyMap[keyName];if(!midi||heldPianoKeys.has(keyName))return;
  event.preventDefault();const voice=playInstrumentNote('piano',midi,.24,'Computer key '+keyName.toUpperCase());heldPianoKeys.set(keyName,voice);
  const key=controls.querySelector(`[aria-label="Play ${pitchName(midi)}"]`);if(key){key.classList.add('playing');activeControls.add(key);}
}
function releasePianoComputerKey(event){
  const keyName=event.key.toLowerCase();if(!heldPianoKeys.has(keyName))return;const voice=heldPianoKeys.get(keyName);heldPianoKeys.delete(keyName);if(voice)stopVoice(voice);const midi=pianoKeyMap[keyName];const key=controls.querySelector(`[aria-label="Play ${pitchName(midi)}"]`);if(key){key.classList.remove('playing');activeControls.delete(key)}
}function renderGuitarSvg(){
  const fretLines=Array.from({length:24},(_,index)=>{const fret=index+1,x=132+760*(1-2**(-fret/12));return `<line class="guitar-fret-wire" x1="${x.toFixed(1)}" y1="94" x2="${x.toFixed(1)}" y2="186"/>`}).join('');
  const strings=Array.from({length:6},(_,index)=>{const y=111+index*12,stringIndex=index,thickness=(2.3-index*.19).toFixed(1);return `<g class="guitar-svg-string" data-guitar-string="${stringIndex}" role="button" tabindex="0" aria-label="Strum ${notes.guitar[stringIndex][0]} string"><line class="guitar-string-hit" x1="77" y1="${y}" x2="919" y2="${y}"/><line class="guitar-string-visible" style="stroke-width:${thickness}" x1="77" y1="${y}" x2="919" y2="${y}"/></g>`}).join('');
  const tuningMachines=Array.from({length:6},(_,index)=>{const x=43+(index%3)*23,y=index<3?96:168,side=index<3?-1:1;return `<g class="guitar-tuning-machine"><path d="M${x} ${y}h${side*18}"/><circle cx="${x}" cy="${y}" r="6"/><ellipse cx="${x+side*21}" cy="${y}" rx="8" ry="5"/></g>`}).join('');
  return `<svg class="guitar-diagram" viewBox="0 0 1000 280" role="img" aria-label="Acoustic guitar with six correctly ordered strings, wood body, sound hole, bridge, frets and tuning pegs">
    <defs>
      <linearGradient id="guitarWood" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#f1c58e"/><stop offset=".28" stop-color="#d9975d"/><stop offset=".62" stop-color="#b96f3e"/><stop offset="1" stop-color="#754326"/></linearGradient>
      <linearGradient id="guitarFretboard" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#503c2e"/><stop offset=".5" stop-color="#312920"/><stop offset="1" stop-color="#6d4a2c"/></linearGradient>
      <radialGradient id="guitarTop" cx=".28" cy=".24" r=".9"><stop stop-color="#ffe1ad" stop-opacity=".65"/><stop offset=".45" stop-color="#d28a51" stop-opacity=".12"/><stop offset="1" stop-color="#392319" stop-opacity=".38"/></radialGradient>
      <filter id="guitarShadow" x="-.1" y="-.2" width="1.2" height="1.5"><feGaussianBlur stdDeviation="8"/></filter>
    </defs>
    <ellipse cx="566" cy="246" rx="395" ry="17" fill="#382719" opacity=".14" filter="url(#guitarShadow)"/>
    <path class="guitar-body" d="M589 105C631 61 685 30 747 33C799 35 823 68 852 76C883 84 912 50 946 63C987 79 997 121 974 143C959 158 960 170 975 186C995 207 980 248 944 263C907 278 879 245 851 237C821 228 801 261 753 267C690 274 634 242 599 202C565 164 560 135 589 105Z"/>
    <path d="M590 105C631 61 685 30 747 33C799 35 823 68 852 76C883 84 912 50 946 63C987 79 997 121 974 143C959 158 960 170 975 186C995 207 980 248 944 263C907 278 879 245 851 237C821 228 801 261 753 267C690 274 634 242 599 202C565 164 560 135 590 105Z" fill="url(#guitarTop)"/>
    <path class="guitar-binding" d="M604 107C644 69 691 43 747 46C798 48 822 79 852 88C888 98 915 65 943 77C973 91 981 122 962 143C946 161 947 171 964 189C981 208 968 237 941 250C909 265 882 234 850 225C814 215 797 248 751 251C696 256 649 228 617 194C586 161 579 133 604 107Z"/>
    <path class="guitar-neck-wood" d="M101 104H683L704 188H101Z"/><path class="guitar-fretboard" d="M136 106H682L703 186H136Z"/>${fretLines}
    <path class="guitar-head" d="M127 99L66 88Q38 83 31 105L22 139Q18 160 43 167L130 185Z"/><path class="guitar-nut" d="M132 101L135 187"/>
    <circle class="guitar-rosette-outer" cx="750" cy="147" r="48"/><circle class="guitar-soundhole" cx="750" cy="147" r="35"/><circle class="guitar-rosette-inner" cx="750" cy="147" r="39"/>
    <path class="guitar-pickguard" d="M798 160Q829 162 846 199Q822 219 794 213Q779 191 779 166Z"/><path class="guitar-bridge" d="M867 116Q880 147 867 178"/><path class="guitar-saddle" d="M861 112Q870 147 861 182"/>
    ${Array.from({length:6},(_,index)=>`<circle class="guitar-bridge-pin" cx="872" cy="${111+index*12}" r="3.6"/>`).join('')}${tuningMachines}
    <path class="guitar-inlay" d="M272 125l6 20-6 20-6-20zM409 125l6 20-6 20-6-20zM515 125l6 20-6 20-6-20zM602 125l6 20-6 20-6-20z"/>${strings}
  </svg>`;
}
function renderViolinSvg(){
  const stringMarkup=[225,241,258,275].map((y,index)=>{const [label]=notes.violin[index];return `<g class="violin-model-string" data-string-index="${index}" role="button" tabindex="0" aria-label="Play open ${label} violin string"><line class="violin-string-hit" x1="127" y1="${y}" x2="1072" y2="${y}"/><line class="violin-string-visible" x1="127" y1="${y}" x2="1072" y2="${y}"/><line class="violin-string-glint" x1="127" y1="${y-1}" x2="1072" y2="${y-1}"/></g>`}).join('');
  return `<svg class="violin-diagram" viewBox="0 0 1240 500" role="img" aria-label="Full acoustic violin viewed from the front, with carved scroll, four tuning pegs, ebony fingerboard, four strings, bridge, f-holes, tailpiece, and chin rest">
    <defs>
      <linearGradient id="violinWood" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#542d1d"/><stop offset=".18" stop-color="#ad6940"/><stop offset=".38" stop-color="#d99a5e"/><stop offset=".58" stop-color="#9d552f"/><stop offset=".78" stop-color="#c77d49"/><stop offset="1" stop-color="#63351f"/></linearGradient>
      <linearGradient id="violinPlate" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#e1ab6c"/><stop offset=".22" stop-color="#b96f3f"/><stop offset=".5" stop-color="#8b492a"/><stop offset=".76" stop-color="#c57c48"/><stop offset="1" stop-color="#6a3823"/></linearGradient>
      <linearGradient id="violinEbony" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#302a27"/><stop offset=".45" stop-color="#171616"/><stop offset="1" stop-color="#44352c"/></linearGradient>
      <linearGradient id="violinStringMetal" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#7c715d"/><stop offset=".4" stop-color="#fff4d8"/><stop offset=".7" stop-color="#b9a788"/><stop offset="1" stop-color="#f7e9c7"/></linearGradient>
      <linearGradient id="violinBridgeWood" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#c9a572"/><stop offset=".5" stop-color="#f0d6a2"/><stop offset="1" stop-color="#9b744b"/></linearGradient>
      <radialGradient id="violinVarnish" cx=".35" cy=".28" r=".82"><stop stop-color="#f1bd7a" stop-opacity=".58"/><stop offset=".45" stop-color="#e39a59" stop-opacity=".15"/><stop offset="1" stop-color="#351d13" stop-opacity=".38"/></radialGradient>
      <filter id="violinShadow" x="-.12" y="-.2" width="1.24" height="1.5"><feGaussianBlur stdDeviation="9"/></filter>
    </defs>
    <ellipse class="violin-shadow" cx="631" cy="462" rx="552" ry="20" filter="url(#violinShadow)"/>
    <path class="violin-body" d="M602 176C635 112 699 73 770 78C816 81 838 108 865 128C884 141 906 141 925 128C956 107 980 78 1032 80C1110 83 1162 142 1167 211Q1169 231 1148 242Q1127 250 1148 258Q1169 269 1167 290C1162 359 1110 417 1032 420C980 422 956 393 925 372C906 359 884 359 865 372C838 392 816 419 770 422C699 427 635 389 602 324C577 275 577 225 602 176Z"/>
    <path class="violin-varnish" d="M602 176C635 112 699 73 770 78C816 81 838 108 865 128C884 141 906 141 925 128C956 107 980 78 1032 80C1110 83 1162 142 1167 211Q1169 231 1148 242Q1127 250 1148 258Q1169 269 1167 290C1162 359 1110 417 1032 420C980 422 956 393 925 372C906 359 884 359 865 372C838 392 816 419 770 422C699 427 635 389 602 324C577 275 577 225 602 176Z"/>
    <path class="violin-purfling" d="M616 179C650 123 705 89 768 91C811 93 834 118 858 137C883 157 909 157 933 137C965 110 988 92 1030 94C1095 97 1143 149 1150 212Q1152 231 1134 243Q1114 250 1134 257Q1152 269 1150 289C1143 352 1095 402 1030 406C988 408 965 390 933 363C909 343 883 343 858 363C834 382 811 407 768 409C705 411 650 377 616 321C594 276 594 224 616 179Z"/>
    <path class="violin-neck-wood" d="M98 205L623 178Q650 176 674 191L674 309Q648 324 623 322L98 295Z"/>
    <path class="violin-pegbox" d="M87 207L161 211L164 289L87 293L54 272Q44 250 54 228Z"/>
    <path class="violin-scroll" d="M102 210C67 188 32 204 31 235C28 270 57 292 84 279C105 269 108 245 91 234C76 224 60 235 63 249C66 263 83 261 85 250"/>
    <path class="violin-scroll-highlight" d="M95 215C65 198 43 211 42 235C39 260 57 279 78 270"/>
    <path class="violin-fingerboard" d="M119 215L665 184L665 316L119 285Z"/>
    <path class="violin-fingerboard-highlight" d="M131 221L653 193"/>
    <path class="violin-nut" d="M121 210L133 211L133 289L121 289Z"/>
    <g class="violin-pegs">
      <path class="violin-peg-shaft" d="M138 213L166 191M173 211L201 190M140 287L168 309M175 289L203 311"/>
      <ellipse cx="164" cy="191" rx="19" ry="9" transform="rotate(-35 164 191)"/>
      <ellipse cx="202" cy="190" rx="19" ry="9" transform="rotate(-35 202 190)"/>
      <ellipse cx="166" cy="309" rx="19" ry="9" transform="rotate(35 166 309)"/>
      <ellipse cx="204" cy="311" rx="19" ry="9" transform="rotate(35 204 311)"/>
    </g>
    <path class="violin-f-hole" d="M742 177C730 187 727 198 731 211L737 229C739 235 735 239 728 244M748 323C736 313 733 301 737 289L743 271C745 265 741 261 734 256"/>
    <path class="violin-f-hole" d="M1002 177C1014 187 1017 198 1013 211L1007 229C1005 235 1009 239 1016 244M996 323C1008 313 1011 301 1007 289L1001 271C999 265 1003 261 1010 256"/>
    <circle class="violin-f-hole-nick" cx="734" cy="229" r="4"/><circle class="violin-f-hole-nick" cx="1009" cy="229" r="4"/>
    <path class="violin-tailpiece" d="M909 228Q977 231 1056 241L1063 250L1056 259Q977 269 909 272L894 260V240Z"/>
    <path class="violin-tailpiece-inlay" d="M921 239Q978 241 1038 248M921 261Q978 259 1038 252"/>
    <path class="violin-chinrest" d="M930 326Q990 311 1058 329L1070 350Q1015 371 954 356Q934 349 930 326Z"/>
    <path class="violin-chinrest-edge" d="M939 331Q994 320 1055 335"/>
    <path class="violin-bridge-svg" d="M866 209Q877 199 888 209L894 224L891 274L886 292Q879 299 872 290L866 270L863 229Z"/>
    <path class="violin-bridge-cutout" d="M870 218Q880 222 890 217M872 280Q880 275 889 281"/>
    <path class="violin-bridge-foot" d="M866 286L894 286M867 292L892 292"/>
    ${stringMarkup}
    <path class="violin-tailgut" d="M1056 250L1080 250"/>
    <ellipse class="violin-endpin" cx="1082" cy="250" rx="11" ry="8"/>
    <g class="violin-fine-tuners"><circle cx="918" cy="225" r="4"/><circle cx="918" cy="241" r="4"/><circle cx="918" cy="258" r="4"/><circle cx="918" cy="275" r="4"/></g>
  </svg>`;
}
function renderFluteSvg(){
  const keys=[
    ['T',382,132,'thumb'],['B',420,140,'lever'],['Bb',452,140,'lever'],
    ['L1',485,190,'main'],['L2',550,190,'main'],['L3',615,190,'main'],['G#',665,194,'lever'],
    ['R1',735,190,'main'],['R2',800,190,'main'],['R3',865,190,'main'],
    ['D',925,143,'trill'],['Eb',957,218,'trill'],['C',990,143,'trill'],['C#',1022,218,'trill'],['Bfoot',1090,216,'foot']
  ];
  const keyMarkup=keys.map(([key,x,y,type])=>{
    const main=type==='main',foot=type==='foot',r=main?17:foot?14:12,ry=main?14:foot?11:9;
    const rodY=y<165?124:226,armX=x+(key==='G#'?18:0);
    const label=key.replace('#','♯');
    return `<g class="wind-key flute-key open ${type}" data-key="${key}" data-finger="${label}">
      <circle class="flute-key-hit" cx="${x}" cy="${y}" r="${main?27:23}"/>
      <path class="flute-key-arm-shadow" d="M${x} ${y+ry-2}L${armX} ${rodY}"/>
      <path class="flute-key-arm" d="M${x} ${y+ry-2}L${armX} ${rodY}"/>
      <circle class="flute-post" cx="${armX}" cy="${rodY}" r="4"/>
      <ellipse class="key-rim" cx="${x}" cy="${y}" rx="${r}" ry="${ry}"/>
      <circle class="key-pad" cx="${x}" cy="${y}" r="${main?10:8}"/>
      <ellipse class="flute-pad-glint" cx="${x-3}" cy="${y-4}" rx="${main?4:3}" ry="2"/>
      <text class="flute-key-label" x="${x}" y="${main||foot?249:y-16}">${label}</text>
    </g>`;
  }).join('');
  const posts=[388,425,485,550,615,665,735,800,865,925,990,1022,1072].map((x,i)=>`<circle class="flute-post" cx="${x}" cy="${i<2?124:226}" r="3.5"/>`).join('');
  return `<svg class="flute-diagram" viewBox="0 0 1200 330" role="img" aria-label="Concert flute with headjoint, crown, lip plate, embouchure hole, silver body and footjoint, key rods, posts, and playable keys">
    <defs>
      <linearGradient id="fluteMetal" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#707a7b"/><stop offset=".13" stop-color="#f9fbfa"/><stop offset=".31" stop-color="#b9c0c0"/><stop offset=".48" stop-color="#f5f7f5"/><stop offset=".68" stop-color="#a7aeae"/><stop offset=".86" stop-color="#eef0ee"/><stop offset="1" stop-color="#737b7c"/></linearGradient>
      <linearGradient id="fluteRodMetal" x1="0" x2="1"><stop stop-color="#697172"/><stop offset=".22" stop-color="#f7f8f7"/><stop offset=".5" stop-color="#9aa1a1"/><stop offset=".78" stop-color="#fff"/><stop offset="1" stop-color="#727a7b"/></linearGradient>
      <linearGradient id="fluteCupMetal" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff"/><stop offset=".35" stop-color="#b9c0bf"/><stop offset=".58" stop-color="#f9fbf8"/><stop offset="1" stop-color="#778080"/></linearGradient>
      <linearGradient id="fluteInside" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#202729"/><stop offset=".5" stop-color="#090d0e"/><stop offset="1" stop-color="#485153"/></linearGradient>
      <filter id="fluteShadow" x="-.1" y="-.5" width="1.2" height="2"><feGaussianBlur stdDeviation="6"/></filter>
    </defs>
    <ellipse class="flute-shadow" cx="600" cy="258" rx="510" ry="16" filter="url(#fluteShadow)"/>
    <path class="flute-tube-shadow" d="M80 152Q80 137 99 137H1002Q1025 137 1043 147L1110 153Q1140 157 1140 179Q1140 200 1110 204L1041 212Q1022 218 1002 218H99Q80 218 80 202Z"/>
    <path class="flute-tube" d="M80 148Q80 134 99 134H1001Q1024 134 1042 144L1111 150Q1132 152 1140 167V185Q1132 201 1111 203L1041 210Q1023 216 1001 216H99Q80 216 80 202Z"/>
    <path class="flute-headjoint" d="M102 139H348V211H102Q80 211 80 194V156Q80 139 102 139Z"/>
    <path class="flute-body-joint" d="M348 139H1004V211H348Z"/>
    <path class="flute-footjoint" d="M1000 145Q1023 145 1042 151L1112 157Q1130 159 1137 171V184Q1129 196 1111 198L1041 205Q1020 211 1000 211Z"/>
    <path class="flute-cylinder-highlight" d="M103 145H1004Q1028 145 1046 153L1110 159" />
    <path class="flute-cylinder-shadow" d="M102 204H1000Q1022 204 1040 198L1111 192"/>
    <path class="flute-joint-ring" d="M344 137V213M353 138V212M994 141V211M1003 143V210"/>
    <ellipse class="flute-crown" cx="80" cy="175" rx="12" ry="37"/>
    <ellipse class="flute-crown-cap" cx="74" cy="175" rx="7" ry="26"/>
    <path class="flute-lip-plate" d="M170 148Q176 119 208 115Q241 117 251 145L247 157Q214 151 174 165Z"/>
    <ellipse class="embouchure" cx="211" cy="139" rx="15" ry="6"/>
    <ellipse class="flute-embouchure-inner" cx="211" cy="139" rx="9" ry="3"/>
    <path class="flute-rod-shadow" d="M382 125H909M392 230H913M930 125H1025M936 230H1051"/>
    <path class="flute-rod" d="M382 123H909M392 228H913M930 123H1025M936 228H1051"/>
    <path class="flute-rod-link" d="M485 178V123M550 178V228M615 178V123M665 182V228M735 178V123M800 178V228M865 178V123M925 131V123M957 209V228M990 131V123M1022 209V228"/>
    <g class="flute-tone-holes"><circle cx="485" cy="177" r="9"/><circle cx="550" cy="177" r="9"/><circle cx="615" cy="177" r="9"/><circle cx="665" cy="181" r="8"/><circle cx="735" cy="177" r="9"/><circle cx="800" cy="177" r="9"/><circle cx="865" cy="177" r="9"/></g>
    <path class="flute-foot-key-arm" d="M1062 206L1088 230M1100 199L1110 223"/>
    <ellipse class="flute-foot-cup" cx="1090" cy="231" rx="17" ry="8"/>
    <ellipse class="flute-foot-cup" cx="1114" cy="224" rx="13" ry="7"/>
    <ellipse class="flute-bell-rim" cx="1137" cy="178" rx="5" ry="16"/>
    <ellipse class="flute-bell-opening" cx="1138" cy="178" rx="2.5" ry="10"/>
    <g class="flute-key-posts">${posts}</g>${keyMarkup}
  </svg>`;
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
  const pressed=new Set();let selectedWrittenMidi=null,highRegister=false,practiceTarget=null,fingerGuide=true,practiceStatus=null,keyboardNote={code:null,label:null,chartLabel:null,voice:null},registerLatched=false,clarinetAccidental='natural',startNoteShortcut=()=>false,setAccidental=()=>{},stopOpenClarinet=()=>{},fluteAccidental='natural',fluteKeyboardNote={code:null,label:null,voice:null},startFluteNoteShortcut=()=>false,setFluteAccidental=()=>{},setFluteRegister=()=>{};
  art.innerHTML=id==='flute'?renderFluteSvg():renderClarinetSvg();
  const clarinetFunctions=new Map([...art.querySelectorAll('.clarinet-key')].map(key=>[key.dataset.key,key.dataset.function||key.dataset.key]));
  const currentFingering=()=>id==='clarinet'?new Set([...pressed].map(key=>clarinetFunctions.get(key)||key)):pressed;
  if(id==='clarinet')controls.append(buildClarinetViewControls(art.querySelector('.clarinet-diagram')));
  if(id==='flute'){const embouchure=art.querySelector('.embouchure');embouchure.setAttribute('role','button');embouchure.setAttribute('tabindex','0');embouchure.setAttribute('aria-label','Switch to the upper flute octave');embouchure.setAttribute('aria-pressed','false');embouchure.addEventListener('click',()=>setFluteRegister(!highRegister));embouchure.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&!event.repeat){event.preventDefault();embouchure.click()}});}
  if(id==='clarinet'){
    const mouthpiece=art.querySelector('.clarinet-mouthpiece');let openVoice=null;
    mouthpiece.setAttribute('role','button');mouthpiece.setAttribute('tabindex','0');mouthpiece.setAttribute('aria-label','Hold the clarinet mouthpiece to play open written G4');mouthpiece.setAttribute('aria-pressed','false');
    const startOpen=event=>{if(pressed.size||openVoice)return;if(event){event.preventDefault();try{mouthpiece.setPointerCapture(event.pointerId)}catch{}}void ensureAudioReady();openVoice=playInstrumentNote('clarinet',midiForName('G4')-2,.24,'Open G4 · breath');mouthpiece.classList.add('mouthpiece-active');mouthpiece.setAttribute('aria-pressed','true');document.querySelector('#note-info').textContent=`Clarinet · Written G4 · concert ${pitchName(midiForName('G4')-2)} · open fingering`;if(practiceStatus&&practiceTarget==='G4'){practiceStatus.textContent='Correct · Written G4 · concert '+pitchName(midiForName('G4')-2);practiceStatus.classList.add('practice-success')}};
    const stopOpen=()=>{if(!openVoice)return;stopVoice(openVoice,false);openVoice=null;mouthpiece.classList.remove('mouthpiece-active');mouthpiece.setAttribute('aria-pressed','false')};stopOpenClarinet=stopOpen;
    mouthpiece.addEventListener('pointerdown',startOpen);mouthpiece.addEventListener('pointerup',stopOpen);mouthpiece.addEventListener('pointercancel',stopOpen);mouthpiece.addEventListener('lostpointercapture',stopOpen);mouthpiece.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.repeat){event.preventDefault();startOpen()}});mouthpiece.addEventListener('keyup',event=>{if(event.key==='Enter')stopOpen()});
  }  const heldInputs=new Map(),heldComputerKeys=new Map();
  const pressWindKey=(key,source)=>{if(id==='clarinet')void ensureAudioReady();const keyName=key.dataset.key,holders=heldInputs.get(keyName)||new Set();if(holders.has(source))return;holders.add(source);heldInputs.set(keyName,holders);if(pressed.has(keyName))return;pressed.add(keyName);if(id==='clarinet'&&keyName==='R'&&keyboardNote.code){updateWindDiagram(pressed);startNoteShortcut(keyboardNote.code);return}updateWindDiagram(pressed);playRecognizedFingering()};
  const releaseWindKey=(key,source)=>{const keyName=key.dataset.key,holders=heldInputs.get(keyName);if(!holders?.has(source))return;holders.delete(source);if(holders.size)return;heldInputs.delete(keyName);pressed.delete(keyName);if(id==='clarinet'&&keyName==='R'&&keyboardNote.code){updateWindDiagram(pressed);startNoteShortcut(keyboardNote.code);return}updateWindDiagram(pressed);if(id==='clarinet'&&pressed.size){playRecognizedFingering();return}stopInstrumentSounds(id,false,id==='clarinet'?.008:.11);for(const note of pendingNotes[id]||[])stopVoice(note,true);pendingNotes[id]=[];document.querySelector('#note-info').textContent=`${info[id].name} · Released · ${[...pressed].join(', ')||'all keys open'}`};
  clearWindControls=()=>{if(id==='flute')releaseFluteKeyboard();stopOpenClarinet();if(keyboardNote.voice)stopVoice(keyboardNote.voice,true);keyboardNote={code:null,label:null,voice:null};registerLatched=false;pressed.clear();heldInputs.clear();heldComputerKeys.clear();updateWindDiagram(pressed);stopInstrumentSounds(id,true);for(const note of pendingNotes[id]||[])stopVoice(note,true);pendingNotes[id]=[]};
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
      if(event.code==='Space'&&!document.querySelector('#song-picker').classList.contains('hidden'))return;
      if(event.code==='Space'){event.preventDefault();if(!event.repeat){if(rhythmState?.instrument==='clarinet')toggleRhythmPause();else{stopPlayback();document.querySelector('#sound-caption').textContent='Playback stopped'}}return}
      if(event.code==='BracketLeft'||event.code==='BracketRight'){event.preventDefault();if(!event.repeat)setAccidental(event.code==='BracketRight'?'sharp':'flat');return}
      if(clarinetNoteKeyboardMap[event.code]&&rhythmState?.instrument!=='clarinet'){event.preventDefault();if(!event.repeat)startNoteShortcut(event.code);return}
      const modelKey=clarinetKeyboardMap[event.code];if(!modelKey)return;event.preventDefault();if(event.repeat||heldComputerKeys.has(event.code))return;if(event.code==='KeyW')registerLatched=!registerLatched;
      const key=art.querySelector(`.clarinet-key[data-key="${modelKey}"]`);if(!key)return;heldComputerKeys.set(event.code,key);pressWindKey(key,`computer:${event.code}`);
    };
    clarinetKeyboardKeyup=event=>{if(player.dataset.instrument!=='clarinet')return;if(event.code==='Space'){event.preventDefault();return}if(keyboardNote.code===event.code){event.preventDefault();releaseActiveNote(event.code);return}const key=heldComputerKeys.get(event.code);if(!key||isTypingTarget(event.target))return;event.preventDefault();heldComputerKeys.delete(event.code);releaseWindKey(key,`computer:${event.code}`)};
  }  let clarinetRhythmFingeringTimer=0;
  function playRecognizedFingering(){
    const evaluate=()=>{
      const soundingKeys=currentFingering(),matches=notes[id].filter(([label])=>fingeringMap[label]&&sameKeySet(soundingKeys,new Set(fingeringMap[label])));
      if(!matches.length){if(id==='clarinet'&&rhythmState?.instrument==='clarinet'){judgeRhythmInput('clarinet',null);return}stopInstrumentSounds(id);for(const note of pendingNotes[id]||[])stopVoice(note,true);pendingNotes[id]=[];document.querySelector('#note-info').textContent=`${info[id].name} · ${pressed.size?'No mapped fingering':'All keys open'}`;return}
      const registerMatches=id==='flute'?matches.filter(candidate=>highRegister?candidate[1]>=84:candidate[1]<84):matches,candidates=registerMatches.length?registerMatches:matches,preferred=selectedWrittenMidi??(id==='flute'?(highRegister?84:72):60),chosen=candidates.reduce((best,candidate)=>Math.abs(candidate[1]-preferred)<Math.abs(best[1]-preferred)?candidate:best,candidates[0]);
      selectedWrittenMidi=chosen[1];const soundingMidi=id==='clarinet'?chosen[1]-2:chosen[1],label=id==='clarinet'?`Written ${chosen[0]} · concert ${pitchName(soundingMidi)}`:chosen[0];if(practiceStatus&&practiceTarget){const hit=chosen[0]===practiceTarget;practiceStatus.textContent=hit?`Correct · ${label}`:`Detected ${label} · keep trying for ${practiceTarget}`;practiceStatus.classList.toggle('practice-success',hit)}
      playInstrumentNote(id,soundingMidi,.24,`Fingering · ${[...pressed].join(', ')||'open'}`);document.querySelector('#note-info').textContent=`${info[id].name} · ${label} · ${[...pressed].join(', ')||'open'}`;
    };
    if(id==='clarinet'&&rhythmState?.instrument==='clarinet'){window.clearTimeout(clarinetRhythmFingeringTimer);clarinetRhythmFingeringTimer=window.setTimeout(evaluate,70);return}
    evaluate();
  }
  if(id==='flute'){
    const fluteControls=document.createElement('section');fluteControls.className='clarinet-practice flute-keyboard-controls';fluteControls.setAttribute('aria-label','Flute keyboard controls');
    const fluteHead=document.createElement('div');fluteHead.className='clarinet-practice-head';
    const fluteTitle=document.createElement('strong');fluteTitle.textContent='Play flute notes with your keyboard';
    const fluteStatus=document.createElement('span');fluteStatus.className='clarinet-practice-status';fluteStatus.setAttribute('aria-live','polite');fluteStatus.textContent='C-B plays C5-B5. Press W for C6-B6.';
    fluteHead.append(fluteTitle,fluteStatus);

    const fluteActions=document.createElement('div');fluteActions.className='clarinet-practice-actions';
    const octaveButton=makeButton('','clarinet-practice-button');
    octaveButton.setAttribute('aria-label','Toggle flute octave');octaveButton.setAttribute('aria-pressed','false');
    octaveButton.addEventListener('click',()=>setFluteRegister(!highRegister));
    fluteActions.append(octaveButton);

    const accidentalControls=document.createElement('div');accidentalControls.className='clarinet-accidental-controls';accidentalControls.setAttribute('aria-label','Flute note modifiers');
    const accidentalLabel=document.createElement('span');accidentalLabel.className='clarinet-accidental-label';accidentalLabel.textContent='Keyboard note modifier';
    const sharpButton=makeButton(String.fromCharCode(0x266f)+' Sharp','clarinet-accidental-button');sharpButton.setAttribute('aria-label','Toggle sharp notes');sharpButton.setAttribute('aria-pressed','false');
    const flatButton=makeButton(String.fromCharCode(0x266d)+' Flat','clarinet-accidental-button');flatButton.setAttribute('aria-label','Toggle flat notes');flatButton.setAttribute('aria-pressed','false');
    setFluteAccidental=mode=>{
      fluteAccidental=fluteAccidental===mode?'natural':mode;
      sharpButton.classList.toggle('active',fluteAccidental==='sharp');flatButton.classList.toggle('active',fluteAccidental==='flat');
      sharpButton.setAttribute('aria-pressed',String(fluteAccidental==='sharp'));flatButton.setAttribute('aria-pressed',String(fluteAccidental==='flat'));
      if(fluteKeyboardNote.code)startFluteNoteShortcut(fluteKeyboardNote.code);
      else fluteStatus.textContent='C-B plays octave '+(highRegister?'6':'5')+' notes; '+(fluteAccidental==='natural'?'natural pitch':fluteAccidental==='sharp'?'sharp pitch selected':'flat pitch selected');
    };
    sharpButton.addEventListener('click',()=>setFluteAccidental('sharp'));flatButton.addEventListener('click',()=>setFluteAccidental('flat'));
    accidentalControls.append(accidentalLabel,sharpButton,flatButton);

    setFluteRegister=high=>{
      highRegister=!!high;
      const embouchure=art.querySelector('.embouchure');
      embouchure.classList.toggle('high-register',highRegister);embouchure.setAttribute('aria-pressed',String(highRegister));
      embouchure.setAttribute('aria-label',highRegister?'Return to flute octave 5':'Switch to flute octave 6');
      octaveButton.textContent='Octave: '+(highRegister?'C6-B6':'C5-B5');
      octaveButton.setAttribute('aria-pressed',String(highRegister));
      document.querySelector('#sound-caption').textContent=highRegister?'Upper flute octave selected':'Middle flute octave selected';
      if(fluteKeyboardNote.code)startFluteNoteShortcut(fluteKeyboardNote.code);
      else if(pressed.size)playRecognizedFingering();
      else fluteStatus.textContent='C-B plays '+(highRegister?'C6-B6':'C5-B5')+'; W or the embouchure toggles octave';
    };

    startFluteNoteShortcut=code=>{
      const baseLabel=fluteNoteKeyboardMap[code];if(!baseLabel)return false;
      const naturalLabel=highRegister?baseLabel.replace(/5$/,'6'):baseLabel;
      const baseMidi=midiForName(naturalLabel),adjustment=fluteAccidental==='sharp'?1:fluteAccidental==='flat'?-1:0,soundingMidi=baseMidi+adjustment;
      const symbol=fluteAccidental==='sharp'?String.fromCharCode(0x266f):fluteAccidental==='flat'?String.fromCharCode(0x266d):'';
      const label=naturalLabel[0]+symbol+naturalLabel.slice(1);
      const chartLabel=fluteAccidental==='natural'?naturalLabel:null;if(!fingeringMap[naturalLabel])return false;
      if(fluteKeyboardNote.code===code&&fluteKeyboardNote.label===label)return true;
      if(fluteKeyboardNote.voice)stopVoice(fluteKeyboardNote.voice,false,.001);
      selectedWrittenMidi=baseMidi;
      updateWindDiagram(chartLabel?new Set(fingeringMap[chartLabel]):new Set());
      fluteKeyboardNote={code,label,voice:null};
      fluteKeyboardNote.voice=playInstrumentNote('flute',soundingMidi,.24,'Keyboard note '+label);
      document.querySelector('#note-info').textContent='Flute | '+label+' | keyboard note';
      fluteStatus.textContent=chartLabel?'Playing '+label+' | press another note key to switch':'Playing '+label+' | chromatic fingering not highlighted';
      return true;
    };

    releaseFluteKeyboard=()=>{
      if(fluteKeyboardNote.voice)stopVoice(fluteKeyboardNote.voice,false,.008);
      fluteKeyboardNote={code:null,label:null,voice:null};updateWindDiagram(pressed);
    };

    const isTypingTarget=target=>target instanceof Element&&!!target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]');
    fluteKeyboardKeydown=event=>{
      if(player.classList.contains('hidden')||player.dataset.instrument!=='flute'||isTypingTarget(event.target)||event.ctrlKey||event.altKey||event.metaKey)return;
      if(event.code==='Space'&&!document.querySelector('#song-picker').classList.contains('hidden'))return;
      if(event.code==='Space'){event.preventDefault();if(!event.repeat){if(rhythmState?.instrument==='flute')toggleRhythmPause();else{stopPlayback();document.querySelector('#sound-caption').textContent='Playback stopped';fluteStatus.textContent='Sound stopped';}}return}
      if(event.code==='BracketLeft'||event.code==='BracketRight'){event.preventDefault();if(!event.repeat)setFluteAccidental(event.code==='BracketRight'?'sharp':'flat');return}
      if(event.code==='KeyW'){event.preventDefault();if(!event.repeat)setFluteRegister(!highRegister);return}
      if(fluteNoteKeyboardMap[event.code]){event.preventDefault();if(!event.repeat)startFluteNoteShortcut(event.code)}
    };
    fluteKeyboardKeyup=event=>{
      if(player.dataset.instrument!=='flute')return;
      if(event.code==='Space'){event.preventDefault();return}
      if(fluteKeyboardNote.code!==event.code)return;
      event.preventDefault();releaseFluteKeyboard();
      if(pressed.size)playRecognizedFingering();
      else{stopInstrumentSounds('flute',false,.008);document.querySelector('#note-info').textContent='Flute | Released';fluteStatus.textContent='Released | press C-B to play another note';}
    };

    const keyboardGuide=document.createElement('details');keyboardGuide.className='clarinet-keyboard-guide';const keyboardSummary=document.createElement('summary');keyboardSummary.textContent='Computer keyboard guide';keyboardGuide.append(keyboardSummary);
    const keyboardList=document.createElement('div');keyboardList.className='clarinet-keyboard-list';
    Object.entries(fluteNoteKeyboardMap).forEach(([code,label])=>{const row=document.createElement('div');row.className='clarinet-keyboard-row';const cap=document.createElement('kbd');cap.textContent=code.replace(/^Key/,'');const description=document.createElement('span');description.textContent='Play '+label+'; in octave 6, it plays '+label.replace(/5$/,'6');row.append(cap,description);keyboardList.append(row)});
    [['W','Toggle between octaves 5 and 6'],['[','Toggle flat; press again for natural'],[']','Toggle sharp; press again for natural'],['Space','Stop active sounds']].forEach(([keyName,descriptionText])=>{const row=document.createElement('div');row.className='clarinet-keyboard-row';const cap=document.createElement('kbd');cap.textContent=keyName;const description=document.createElement('span');description.textContent=descriptionText;row.append(cap,description);keyboardList.append(row)});
    keyboardGuide.append(keyboardList);fluteControls.append(fluteHead,fluteActions,accidentalControls,keyboardGuide);controls.append(fluteControls);
    setFluteRegister(highRegister);
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
  }  const tip=document.createElement('p');tip.className='key-hint';tip.textContent=id==='clarinet'?'Use C–B for notes. Press [ for flat or ] for sharp; press the same key again for natural. W toggles the higher register.':id==='flute'?'Use C-B for flute notes. Press W or the embouchure to switch octaves; [ and ] toggle flat and sharp.':'Tap the instrument keys to cover or uncover them; a matching fingering plays its note.';controls.append(tip);
}
function buildStrings(id){
  if(id==='violin'){
    art.innerHTML=renderViolinSvg();
    const board=document.createElement('div');board.className='string-board instrument-neck violin-neck';
    const header=document.createElement('div');header.className='neck-labels';header.innerHTML='<span>G3 · LOW</span><span>SELECT STRING + FINGER</span><span>E5 · HIGH</span>';board.append(header);
    const positionPicker=document.createElement('div');positionPicker.className='violin-position-picker';positionPicker.setAttribute('role','group');positionPicker.setAttribute('aria-label','Violin hand position');
    const roman=['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];let activePosition=0;
    const neck=document.createElement('div');neck.className='neck violin-fingerboard';neck.dataset.position='0';
    const stringData=notes.violin.map(([label,base])=>({label,baseMidi:Math.round(69+12*Math.log2(base/440))}));
    const buttonRows=[];
    const updateViolinReadout=()=>{const choices=[...selectedViolinNotes.values()];document.querySelector('#note-info').textContent=choices.length?`Violin · ${choices.map(note=>`${pitchName(note.midi)} · ${note.label} string · ${note.place}`).join(' + ')}`:`Violin · Position ${roman[activePosition]} · choose one or two strings`};
    const playViolinFinger=(stringIndex,finger,button,string)=>{const [label]=notes.violin[stringIndex],midi=Number(button.dataset.midi),place=finger===0?'open string':`position ${roman[activePosition]}, finger ${finger}`,semitones=finger===0?0:violinPositionStarts[activePosition]+violinFingerOffsets[finger-1];selectedViolinNotes.set(stringIndex,{midi,label,place,finger});updateViolinReadout();markers[stringIndex].setAttribute('visibility','visible');markers[stringIndex].setAttribute('cx',String(toScreenX(semitones)));markers[stringIndex].setAttribute('cy',String([225,241,258,275][stringIndex]));bow.disabled=false;string.classList.add('playing');window.setTimeout(()=>string.classList.remove('playing'),280);return playInstrumentNote('violin',midi,.24,`${label} string · ${place}`)};
    stringData.forEach(({label},stringIndex)=>{
      const string=document.createElement('div');string.className='neck-string violin-string-row';string.dataset.stringIndex=String(stringIndex);string.style.top=`${100*stringIndex/stringData.length}%`;string.style.height=`${100/stringData.length}%`;string.style.setProperty('--string-weight',`${Math.max(1.5,4.3-stringIndex*.48)}px`);
      const name=document.createElement('span');name.className='neck-string-name';name.textContent=label;string.append(name);
      const path=document.createElement('div');path.className='string-path';string.append(path);
      const touchSurface=document.createElement('div');touchSurface.className='violin-string-touch-surface';touchSurface.setAttribute('role','button');touchSurface.setAttribute('tabindex','0');touchSurface.setAttribute('aria-label',`Play notes on the ${label} string`);touchSurface.title=`Touch along the ${label} string to choose a finger position`;
      wirePlay(touchSurface,event=>{const candidates=buttonRows.filter(button=>Number(button.dataset.stringIndex)===stringIndex);const fingerButton=event&&Number.isFinite(event.clientX)?candidates.reduce((nearest,button)=>Math.abs(button.getBoundingClientRect().left+button.getBoundingClientRect().width/2-event.clientX)<Math.abs(nearest.getBoundingClientRect().left+nearest.getBoundingClientRect().width/2-event.clientX)?button:nearest,candidates[0]):candidates.find(button=>Number(button.dataset.finger)===0);const finger=Number(fingerButton.dataset.finger);string.querySelectorAll('.selected-position').forEach(el=>el.classList.remove('selected-position'));fingerButton.classList.add('selected-position');return playViolinFinger(stringIndex,finger,fingerButton,string)},{release:true,minHoldMs:420});string.append(touchSurface);
      for(let finger=0;finger<=4;finger++){
        const button=makeButton('','position-button violin-finger-button');button.dataset.stringIndex=String(stringIndex);button.dataset.finger=String(finger);
        const fingerName=document.createElement('span');fingerName.className='finger-number';fingerName.textContent=finger===0?'0':String(finger);
        const pitchLabel=document.createElement('span');pitchLabel.className='pitch-label';button.append(fingerName,pitchLabel);
        button.addEventListener('pointerdown',()=>{string.querySelectorAll('.selected-position').forEach(el=>el.classList.remove('selected-position'));button.classList.add('selected-position')});
        wirePlay(button,()=>playViolinFinger(stringIndex,finger,button,string),{release:true,minHoldMs:420});
        string.append(button);buttonRows.push(button);
      }
      neck.append(string);
    });
    const fretEdge=n=>100*(1-2**(-n/12));
    const setHandPosition=index=>{
      if(activePosition!==index)stopInstrumentSounds('violin',true);activePosition=index;neck.dataset.position=String(index);positionPicker.querySelectorAll('.violin-position-button').forEach((button,buttonIndex)=>{const selected=buttonIndex===index;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected))});
      buttonRows.forEach(button=>{const stringIndex=Number(button.dataset.stringIndex),finger=Number(button.dataset.finger),[label,base]=notes.violin[stringIndex],root=Math.round(69+12*Math.log2(base/440)),semitones=finger===0?0:violinPositionStarts[index]+violinFingerOffsets[finger-1],midi=root+semitones,place=finger===0?'open string':`position ${roman[index]}, finger ${finger}`;button.dataset.midi=String(midi);button.style.left=`${finger===0?6:6+94*(fretEdge(semitones-1)+fretEdge(semitones))/2}%`;button.setAttribute('aria-label',`Play ${label} string, ${place}, ${pitchName(midi)}`);button.title=`${label} string · ${place} · ${pitchName(midi)}`;button.querySelector('.pitch-label').textContent=pitchName(midi)});
      board.querySelectorAll('.selected-position').forEach(el=>el.classList.remove('selected-position'));selectedViolinNotes.clear();bow.disabled=true;markers.forEach(marker=>marker.setAttribute('visibility','hidden'));updateViolinReadout();
    };
    roman.forEach((name,index)=>{const button=makeButton(name,'violin-position-button');button.setAttribute('aria-label',`Select violin hand position ${name}`);button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>setHandPosition(index));positionPicker.append(button)});
    const frets=document.createElement('div');frets.className='fret-wires violin-position-guides';neck.append(frets);board.append(positionPicker,neck);controls.appendChild(board);
    const bow=makeButton('Hold bow to play selected note(s)','bow-control');bow.disabled=true;const hint=document.createElement('p');hint.className='key-hint';hint.textContent='Touch anywhere along a lower string to play that position. Hold two string rows together for a double stop, or select both notes and hold the bow.';wirePlay(bow,()=>[...selectedViolinNotes.values()].map(note=>playInstrumentNote('violin',note.midi,.24,`${note.label} string · ${note.place} · bow`)),{release:true});controls.append(bow,hint);
    const svg=art.querySelector('.violin-diagram'),markers=Array.from({length:4},()=>{const marker=document.createElementNS('http://www.w3.org/2000/svg','circle');marker.setAttribute('class','violin-active-finger-marker');marker.setAttribute('r','13');marker.setAttribute('visibility','hidden');marker.setAttribute('aria-hidden','true');svg.append(marker);return marker});
    const stringYs=[225,241,258,275],toScreenX=semitones=>{if(semitones===0)return 130;const edge=n=>1-2**(-n/12);return 130+750*(.06+.94*(edge(semitones-1)+edge(semitones))/2)};
    const playModelString=(group,event)=>{
      const stringIndex=Number(group.dataset.stringIndex),[label,base]=notes.violin[stringIndex],root=Math.round(69+12*Math.log2(base/440));let localX=null;
      if(event&&Number.isFinite(event.clientX)&&svg.getScreenCTM()){try{const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;localX=point.matrixTransform(svg.getScreenCTM().inverse()).x}catch{}}
      let finger=0;if(localX!==null&&localX>=130&&localX<=665){const candidates=Array.from({length:5},(_,index)=>index);finger=candidates.reduce((best,candidate)=>{const semitones=candidate===0?0:violinPositionStarts[activePosition]+violinFingerOffsets[candidate-1];return Math.abs(toScreenX(semitones)-localX)<Math.abs(toScreenX(best===0?0:violinPositionStarts[activePosition]+violinFingerOffsets[best-1])-localX)?candidate:best},0)}
      const semitones=finger===0?0:violinPositionStarts[activePosition]+violinFingerOffsets[finger-1],midi=root+semitones,place=finger===0?'open string':`position ${roman[activePosition]}, finger ${finger}`;selectedViolinNotes.set(stringIndex,{midi,label,place,finger});bow.disabled=false;updateViolinReadout();
      buttonRows.filter(button=>Number(button.dataset.stringIndex)===stringIndex).forEach(button=>button.classList.remove('selected-position'));const matchingButton=buttonRows.find(button=>Number(button.dataset.stringIndex)===stringIndex&&Number(button.dataset.finger)===finger);matchingButton?.classList.add('selected-position');const marker=markers[stringIndex];marker.setAttribute('visibility','visible');marker.setAttribute('cx',String(localX!==null&&localX>=130&&localX<=665?localX:toScreenX(semitones)));marker.setAttribute('cy',String(stringYs[stringIndex]));
      return playInstrumentNote('violin',midi,.24,`${label} string · ${place}`);
    };
    svg.querySelectorAll('.violin-model-string').forEach(group=>wirePlay(group,event=>playModelString(group,event),{release:true,minHoldMs:420}));setHandPosition(0);return;
  }
  art.innerHTML=renderGuitarSvg();
  const board=document.createElement('div');board.className='string-board instrument-neck guitar-neck';
  const header=document.createElement('div');header.className='neck-labels';header.innerHTML='<span>LOW E · E2</span><span>TAP A STRING AT A FRET · OPEN OR 1–24</span><span>HIGH E · E4</span>';board.append(header);
  const neck=document.createElement('div');neck.className='neck guitar-fingerboard';
  const fretEdge=n=>1-2**(-n/12),fretCenter=fret=>fret===0?3:6+94*(fretEdge(fret-1)+fretEdge(fret))/2;
  const inlays=document.createElement('div');inlays.className='fret-inlays';[3,5,7,9,12,15,17,19,21,24].forEach(fret=>{const dot=document.createElement('i');dot.className=fret===12||fret===24?'double-inlay':'';dot.style.left=`${fretCenter(fret)}%`;inlays.append(dot)});neck.append(inlays);
  notes.guitar.forEach(([label,base],stringIndex)=>{
    const baseMidi=Math.round(69+12*Math.log2(base/440)),string=document.createElement('div');string.className='neck-string guitar-fret-string';string.style.top=`${100*stringIndex/notes.guitar.length}%`;string.style.height=`${100/notes.guitar.length}%`;string.setAttribute('role','button');string.tabIndex=0;
    const name=document.createElement('span');name.className='neck-string-name';name.textContent=label;string.append(name);
    const path=document.createElement('div');path.className='string-path';path.style.setProperty('--string-weight',`${Math.max(1.5,4.3-stringIndex*.48)}px`);string.append(path);
    const marker=document.createElement('span');marker.className='guitar-selected-fret';marker.setAttribute('aria-hidden','true');string.append(marker);
    const playFret=(event)=>{
      const rect=string.getBoundingClientRect(),x=event&&Number.isFinite(event.clientX)?Math.max(0,Math.min(100,(event.clientX-rect.left)/rect.width*100)):3;
      const fret=Array.from({length:25},(_,index)=>index).reduce((best,candidate)=>Math.abs(fretCenter(candidate)-x)<Math.abs(fretCenter(best)-x)?candidate:best,0),midi=baseMidi+fret,place=fret===0?'open string':`fret ${fret}`;
      selectedGuitarFrets.set(stringIndex,fret);neck.querySelectorAll('.guitar-fret-string.selected-position').forEach(el=>el.classList.remove('selected-position'));string.classList.add('selected-position');string.style.setProperty('--selected-fret',`${fretCenter(fret)}%`);string.setAttribute('aria-label',`Play ${label} string, ${place}, ${pitchName(midi)}`);string.title=`${label} string · ${place} · ${pitchName(midi)}`;
      return playInstrumentNote('guitar',midi,.24,`${label} string · ${place}`);
    };
    string.setAttribute('aria-label',`Play ${label} string at the selected fret, standard tuning ${label}`);wirePlay(string,playFret);neck.append(string);
  });
  const frets=document.createElement('div');frets.className='fret-wires';for(let fret=1;fret<=24;fret++){const wire=document.createElement('i');wire.style.left=`${6+94*fretEdge(fret)}%`;frets.append(wire)}neck.append(frets);board.append(neck);controls.appendChild(board);
  art.querySelectorAll('[data-guitar-string]').forEach(line=>{const strum=()=>{const index=Number(line.dataset.guitarString),fret=selectedGuitarFrets.get(index)||0,entry=notes.guitar[index],base=Math.round(69+12*Math.log2(entry[1]/440)),midi=base+fret;line.classList.add('strummed');window.setTimeout(()=>line.classList.remove('strummed'),180);playInstrumentNote('guitar',midi,.24,`${entry[0]} string · fret ${fret}`)};line.addEventListener('click',strum);line.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&!event.repeat){event.preventDefault();strum()}})})
}
function buildDrums(){const kit=document.createElement('div');kit.className='drum-kit';[['Closed hi-hat','hat','hi-hat'],['Open hi-hat','hatOpen','open-hat'],['Crash','crash','crash'],['High tom','tomHigh','tomHigh'],['Mid tom','tomMid','tomMid'],['Ride','ride','ride'],['Snare','snare','snare'],['Snare snap','snareSnap','snare-snap'],['Floor tom','tomLow','tomLow'],['Bass drum','bass','bass']].forEach(([label,part,style])=>{const b=makeButton(label,`drum ${style}`);wirePlay(b,()=>hitDrum(part));kit.appendChild(b)});controls.appendChild(kit)}
document.querySelectorAll('[data-instrument]').forEach(card=>card.addEventListener('click',()=>choose(card.dataset.instrument)));
document.querySelector('#back-button').addEventListener('click',()=>leaveInstrument());
document.querySelector('#stop-sound').addEventListener('click',()=>{stopPlayback();stopRhythmGame('Stopped');document.querySelector('#sound-caption').textContent='Playback stopped';});
document.querySelector('#volume-slider').addEventListener('input',event=>{if(master)master.gain.setTargetAtTime(Number(event.target.value)/100,audio.currentTime,.025)});
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(rhythmState)setRhythmPaused(true);else stopPlayback()}});
window.addEventListener('pagehide',()=>{stopRhythmGame('Stopped');stopPlayback()});
document.addEventListener('keydown',playFromComputerKey);
document.addEventListener('keydown',event=>clarinetKeyboardKeydown(event));
document.addEventListener('keyup',event=>clarinetKeyboardKeyup(event));
document.addEventListener('keydown',event=>fluteKeyboardKeydown(event));
document.addEventListener('keyup',event=>fluteKeyboardKeyup(event));
document.addEventListener('keyup',releasePianoComputerKey);
window.addEventListener('blur',()=>{if(player.dataset.instrument==='clarinet'||player.dataset.instrument==='flute')clearWindControls();releaseClarinetKeyboard();releaseFluteKeyboard();if(rhythmState)setRhythmPaused(true);for(const control of [...activeControls])releaseControl(control);for(const voice of heldPianoKeys.values())if(voice)stopVoice(voice);heldPianoKeys.clear()});

// Original rhythm-game patterns. Notes are fixed lane numbers, never randomized.
const rhythmPicker=document.querySelector('#song-picker'),rhythmPanel=document.querySelector('#rhythm-game');
let selectedSong=null,rhythmState=null,rhythmRaf=0,rhythmStartToken=0;
const rhythmPitchLanes={
  piano:[60,62,64,65,67,69,71],guitar:[60,62,64,65,67,69,71],
  violin:[55,57,59,60,62,64,67],
  flute:[72,74,76,77,79,81,83],clarinet:[58,60,62,63,65,67,69]
};
// Original five-song library. Each array entry is one fixed eighth-note slot;
// numbers are scale degrees in C major, and arrays of degrees are chords.
const musicLibrary=[
  {id:'first-light',name:'First Light',bpm:72,difficulty:'Easy',step:.5,pattern:[0,null,2,null,4,null,2,null,1,null,0,null,2,null,4,null,5,null,4,null,2,null,1,null,0,null,2,null,0,null,0,null],chords:[60,65,60,67],description:'A gentle C-major melody with plenty of room to find the beat.'},
  {id:'blue-window',name:'Blue Window',bpm:84,difficulty:'Easy',step:.5,pattern:[0,null,4,null,2,null,5,null,4,null,2,null,1,null,2,null,0,null,4,null,5,null,4,null,2,null,1,null,0,null,0,null],chords:[60,57,65,67],description:'A bright, original melody in an easy steady pulse.'},
  {id:'river-steps',name:'River Steps',bpm:98,difficulty:'Medium',step:.5,pattern:[0,2,null,4,2,null,5,4,null,2,1,null,0,2,null,4,5,null,4,2,null,1,2,null,4,2,null,0,1,null,0,null,0,null],chords:[60,67,57,65],description:'A flowing tune with more frequent note changes.'},
  {id:'lantern-waltz',name:'Lantern Waltz',bpm:108,difficulty:'Medium',step:.5,pattern:[[0,4],null,2,4,null,5,4,null,2,1,null,2,4,null,5,6,null,5,4,null,2,1,null,0,2,null,4,2,null,0,null,0,null],chords:[65,60,67,60],description:'An original lilting melody with a few wider leaps and one two-note chord.'},
  {id:'night-runner',name:'Night Runner',bpm:132,difficulty:'Hard',step:.5,pattern:[0,2,4,null,5,4,2,1,0,null,2,4,6,5,4,2,1,3,5,null,4,2,0,2,4,6,5,3,2,1,0,2,4,2,0,null,0,null,0,null],chords:[57,65,60,67],description:'A quick original C-major run for confident timing.'}
];
// Fixed drum arrangements use lane indexes: kick, snare, closed hat, open hat,
// snare snap, high tom, mid tom, floor tom, ride, and crash.
const drumSongCharts={
  'first-light':[0,null,2,null,1,null,2,null,0,null,2,null,1,null,2,null,0,null,2,null,1,null,2,null,0,null,2,null,1,null,2,null],
  'blue-window':[0,2,2,null,1,2,3,null,0,2,2,null,1,2,3,null,0,2,2,null,1,2,5,null,0,2,2,null,1,2,3,null],
  'river-steps':[0,2,8,2,1,2,8,5,0,2,8,2,1,2,9,6,0,2,8,2,1,5,8,7,0,2,8,2,1,2,9,6,0,2],
  'lantern-waltz':[0,null,2,2,null,8,2,null,1,2,null,4,0,null,2,2,null,8,2,null,1,5,null,6,0,null,2,2,null,9,2,null,1],
  'night-runner':[0,2,8,2,1,2,9,2,0,2,8,5,1,2,8,6,0,2,8,2,1,5,9,7,0,2,8,2,1,2,9,6,0,2,8,5,1,2,9,7]
};
const levelCatalog=[
  {song:'first-light',bpm:72,target:500,difficulty:'Easy'},
  {song:'blue-window',bpm:80,target:650,difficulty:'Easy'},
  {song:'first-light',bpm:88,target:800,difficulty:'Easy'},
  {song:'river-steps',bpm:96,target:1000,difficulty:'Medium'},
  {song:'lantern-waltz',bpm:104,target:1200,difficulty:'Medium'},
  {song:'blue-window',bpm:112,target:1400,difficulty:'Medium'},
  {song:'river-steps',bpm:118,target:1600,difficulty:'Medium'},
  {song:'night-runner',bpm:124,target:1800,difficulty:'Hard'},
  {song:'lantern-waltz',bpm:130,target:2000,difficulty:'Hard'},
  {song:'night-runner',bpm:136,target:2200,difficulty:'Hard'}
];
const achievementCatalog=[
  ['first-note','First Note','Play your first instrument note.'],['first-song','First Song','Finish a song.'],['perfect-start','Perfect Start','Earn 10 Perfect hits.'],['combo-master','Combo Master','Reach a 20-note combo.'],['music-beginner','Music Beginner','Complete 3 different levels.'],['rising-musician','Rising Musician','Complete 5 different levels.'],['music-expert','Music Expert','Complete all 10 levels.'],['three-star-player','Three-Star Player','Earn three stars on a song.'],['instrument-explorer','Instrument Explorer','Play 5 different instruments.'],['clarinet-master','Clarinet Master','Finish 5 songs on clarinet.']
].map(([id,name,description])=>({id,name,description}));
const progressStorageKey='instrument-testing-progress-v1';
const progressDefaults=()=>({unlockedLevels:[1],completedLevels:[],bestScores:{},songStars:{},achievements:{},stats:{totalPerfectHits:0,highestCombo:0,songsCompleted:0,clarinetSongs:0,instrumentsUsed:[]},settings:{practiceMode:false,volume:35}});
function loadPlayerProgress(){
  const defaults=progressDefaults();try{const saved=JSON.parse(localStorage.getItem(progressStorageKey)||'null');if(!saved||typeof saved!=='object')return defaults;return {...defaults,...saved,stats:{...defaults.stats,...saved.stats,instrumentsUsed:Array.isArray(saved.stats?.instrumentsUsed)?saved.stats.instrumentsUsed:[]},settings:{...defaults.settings,...saved.settings},unlockedLevels:Array.isArray(saved.unlockedLevels)&&saved.unlockedLevels.length?saved.unlockedLevels:[1],completedLevels:Array.isArray(saved.completedLevels)?saved.completedLevels:[],bestScores:saved.bestScores&&typeof saved.bestScores==='object'?saved.bestScores:{},songStars:saved.songStars&&typeof saved.songStars==='object'?saved.songStars:{},achievements:saved.achievements&&typeof saved.achievements==='object'?saved.achievements:{}}}catch{return defaults}
}
const playerProgress=loadPlayerProgress();
let appFlow='free',selectedLevelNumber=null,achievementToastTimer=0,selectedLibrarySongId=null;
function savePlayerProgress(){try{localStorage.setItem(progressStorageKey,JSON.stringify(playerProgress))}catch(error){console.warn('Progress could not be saved in this browser',error)}}
function unlockAchievement(id){
  if(playerProgress.achievements[id])return;const achievement=achievementCatalog.find(item=>item.id===id);if(!achievement)return;playerProgress.achievements[id]=Date.now();savePlayerProgress();renderAchievements();const toast=document.querySelector('#achievement-toast');toast.textContent=`Achievement unlocked · ${achievement.name}`;toast.classList.remove('hidden');window.clearTimeout(achievementToastTimer);achievementToastTimer=window.setTimeout(()=>toast.classList.add('hidden'),3200);
}
function recordPlayerAction(instrument){
  if(!playerProgress.stats.instrumentsUsed.includes(instrument))playerProgress.stats.instrumentsUsed.push(instrument);savePlayerProgress();unlockAchievement('first-note');if(playerProgress.stats.instrumentsUsed.length>=5)unlockAchievement('instrument-explorer');
}
function niceLength(song){const seconds=Math.round(song.pattern.length*song.step*60/song.bpm);return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`}
function renderAchievements(){
  const list=document.querySelector('#achievements-list');if(!list)return;list.replaceChildren();achievementCatalog.forEach(item=>{const unlocked=!!playerProgress.achievements[item.id],card=document.createElement('article');card.className=`achievement-card${unlocked?' unlocked':''}`;const mark=document.createElement('span');mark.className='achievement-mark';mark.textContent=unlocked?'♪':'○';const copy=document.createElement('div'),title=document.createElement('strong'),description=document.createElement('p');title.textContent=item.name;description.textContent=item.description;copy.append(title,description);const state=document.createElement('small');state.textContent=unlocked?'Unlocked':'Locked';card.append(mark,copy,state);list.append(card)})
}
function renderLevels(){
  const list=document.querySelector('#levels-list'),summary=document.querySelector('#level-summary');if(!list)return;list.replaceChildren();const unlocked=new Set(playerProgress.unlockedLevels);summary.textContent=`${playerProgress.completedLevels.length}/10 completed`;
  levelCatalog.forEach((level,index)=>{const number=index+1,available=unlocked.has(number),done=playerProgress.completedLevels.includes(number),button=document.createElement('button');button.type='button';button.className=`level-card${available?'':' locked'}${done?' completed':''}`;button.disabled=!available;const badge=document.createElement('span');badge.className='level-number';badge.textContent=String(number).padStart(2,'0');const body=document.createElement('span');body.className='level-copy';const name=document.createElement('strong'),detail=document.createElement('small'),best=document.createElement('small');const song=musicLibrary.find(item=>item.id===level.song);name.textContent=`Level ${number} · ${song?.name||'Practice'}`;detail.textContent=`${level.bpm} BPM · ${level.difficulty} · Target ${level.target.toLocaleString()} points`;best.textContent=done?`Completed · best ${Number(playerProgress.bestScores[`level-${number}`]||0).toLocaleString()}`:available?'Ready to play':'Unlock the previous level';body.append(name,detail,best);const status=document.createElement('span');status.className='level-status';status.textContent=done?'✓':available?'→':'🔒';button.append(badge,body,status);button.addEventListener('click',()=>{if(!available)return;selectedLevelNumber=number;openInstrumentChooser('level')});list.append(button)});
}
function updatePracticeSetting(value){playerProgress.settings.practiceMode=!!value;document.querySelector('#practice-mode').checked=!!value;document.querySelector('#practice-mode-picker').checked=!!value;savePlayerProgress()}
function applySavedSettings(){
  const volume=Math.max(0,Math.min(100,Number(playerProgress.settings.volume)||0));document.querySelector('#volume-slider').value=String(volume);document.querySelector('#settings-volume').value=String(volume);document.querySelector('#practice-mode').checked=!!playerProgress.settings.practiceMode;document.querySelector('#practice-mode-picker').checked=!!playerProgress.settings.practiceMode;
}
function hideHomeSubpages(){document.querySelectorAll('.home-page').forEach(page=>page.classList.add('hidden'))}
function openPlayModesPage(){stopRhythmGame('');stopPlayback();player.classList.add('hidden');player.classList.remove('rhythm-playing');player.removeAttribute('data-instrument');chooser.classList.add('hidden');welcome.classList.add('hidden');hideHomeSubpages();document.querySelector('#play-modes-page').classList.remove('hidden')}
function renderLibrarySongs(){
  const list=document.querySelector('#library-songs-list'),rhythmMode=appFlow==='rhythm';list.replaceChildren();selectedLibrarySongId=null;selectedSong=null;musicLibrary.forEach(song=>{const card=document.createElement('button');card.type='button';card.className=`library-song-card${rhythmMode?' rhythm-song-card':''}`;const title=document.createElement('strong'),meta=document.createElement('span'),length=document.createElement('span'),best=document.createElement('small'),action=document.createElement('span');title.textContent=song.name;meta.textContent=`${song.bpm} BPM · ${song.difficulty}`;length.textContent=`${niceLength(song)} · original practice melody`;const scores=Object.entries(playerProgress.bestScores).filter(([key])=>key.endsWith(`:${song.id}`)).map(([,score])=>Number(score)||0);best.textContent=`Best score ${Math.max(0,...scores).toLocaleString()} · ${'★'.repeat(playerProgress.songStars[song.id]||0)}${'☆'.repeat(3-(playerProgress.songStars[song.id]||0))}`;action.className='library-card-action';action.textContent=rhythmMode?'Choose for rhythm game →':'Play from library →';card.append(title,meta,length);if(!rhythmMode)card.append(best);card.append(action);card.addEventListener('click',()=>{selectedLibrarySongId=song.id;selectedSong=song;const nextFlow=rhythmMode?'rhythm-picked':'library-picked';openInstrumentChooser(nextFlow)});list.append(card)})
}
function openSongSelectionPage(flow='library'){
  stopRhythmGame('');stopPlayback();appFlow=flow;player.classList.add('hidden');player.classList.remove('rhythm-playing');chooser.classList.add('hidden');welcome.classList.add('hidden');hideHomeSubpages();document.querySelector('#song-library-page').classList.remove('hidden');
  const rhythm=flow==='rhythm';document.querySelector('#library-eyebrow').textContent=rhythm?'PICK A SONG TO PLAY':'ORIGINAL PRACTICE SONGS';document.querySelector('#library-title').textContent=rhythm?'Rhythm Mode':'Song Library';document.querySelector('#library-help').textContent=rhythm?'Choose a practice song, then pick an instrument for the rhythm game.':'Choose a song to play, then pick an instrument.';renderLibrarySongs();window.scrollTo({top:0,behavior:'smooth'});
}
function openLibraryPage(){openSongSelectionPage('library')}
function openRhythmPage(){openSongSelectionPage('rhythm')}
function openLevelsPage(){stopRhythmGame('');stopPlayback();appFlow='level';selectedLevelNumber=null;selectedSong=null;player.classList.add('hidden');player.classList.remove('rhythm-playing');chooser.classList.add('hidden');welcome.classList.add('hidden');hideHomeSubpages();document.querySelector('#levels-page').classList.remove('hidden');renderLevels();window.scrollTo({top:0,behavior:'smooth'})}
function handleChooserBack(){if(appFlow==='library-picked'){openLibraryPage();return}if(appFlow==='rhythm-picked'){openRhythmPage();return}if(appFlow==='level'){openLevelsPage();return}showMainMenu()}
function showMainMenu(){stopRhythmGame('');stopPlayback();appFlow='free';selectedLevelNumber=null;selectedLibrarySongId=null;selectedSong=null;player.classList.add('hidden');player.classList.remove('rhythm-playing');player.removeAttribute('data-instrument');chooser.classList.add('hidden');document.querySelector('#song-picker').classList.add('hidden');rhythmPanel.classList.add('hidden');document.querySelector('#results-panel').classList.add('hidden');document.querySelector('#stage').classList.remove('rhythm-active');hideHomeSubpages();welcome.classList.remove('hidden');window.scrollTo({top:0,behavior:'smooth'})}
function openInstrumentChooser(flow='free'){
  stopRhythmGame('');stopPlayback();appFlow=flow;welcome.classList.add('hidden');hideHomeSubpages();player.classList.add('hidden');player.classList.remove('rhythm-playing');document.querySelector('#song-picker').classList.add('hidden');rhythmPanel.classList.add('hidden');document.querySelector('#results-panel').classList.add('hidden');chooser.classList.remove('hidden');
  const context=document.querySelector('#chooser-context'),copy=document.querySelector('#chooser-copy'),back=document.querySelector('#chooser-back');
  if(flow==='free'){context.textContent='FREE PLAY · CHOOSE AN INSTRUMENT';copy.textContent='Tap any control to explore its sound. No song or countdown.';back.textContent='← Main menu'}
  else if(flow==='rhythm-picked'){context.textContent='RHYTHM MODE · CHOOSE AN INSTRUMENT';copy.textContent='Your song is selected. Choose an instrument, then play the notes in time.';back.textContent='← Back to songs'}
  else if(flow==='library-picked'){context.textContent='SONG LIBRARY · CHOOSE AN INSTRUMENT';copy.textContent='Your song is selected. Choose an instrument to start playing.';back.textContent='← Back to Song Library'}
  else if(flow==='level'){context.textContent=`LEVEL ${selectedLevelNumber||''} · CHOOSE AN INSTRUMENT`;copy.textContent='Choose an instrument to play this level.';back.textContent='← Back to levels'}
  else{context.textContent='CHOOSE AN INSTRUMENT';copy.textContent='Pick an instrument to continue to song selection.';back.textContent='← Main menu'}
  window.scrollTo({top:0,behavior:'smooth'});
}
function openSongPicker(){
  const picker=document.querySelector('#song-picker');player.classList.remove('rhythm-playing');rhythmPanel.classList.add('hidden');document.querySelector('#results-panel').classList.add('hidden');picker.classList.remove('hidden');document.querySelector('#stage').classList.add('rhythm-active');buildSongPicker();window.scrollTo({top:0,behavior:'smooth'});
}
function choose(id){
  const current=info[id];if(!current)return;if(id==='guitar')selectedGuitarFrets.clear();if(id==='violin')selectedViolinNotes.clear();const previous=player.dataset.instrument;if(previous&&previous!==id)delete pendingNotes[previous];if(id!=='drums')pendingDrums.length=0;stopRhythmGame('');stopPlayback();void ensureAudioReady();chooser.classList.add('hidden');welcome.classList.add('hidden');hideHomeSubpages();player.classList.remove('hidden');player.dataset.instrument=id;document.querySelector('#instrument-title').textContent=current.name;document.querySelector('#instrument-icon').textContent=current.icon;document.querySelector('#instrument-icon').style.background=colors[id];document.querySelector('#sound-caption').textContent='Loading instrument samples…';document.querySelector('#note-info').textContent='Choose a control to see its note and fingering.';art.className=`instrument-art ${id}-art`;art.replaceChildren();controls.replaceChildren();
  player.classList.remove('rhythm-playing');document.querySelector('#song-picker').classList.add('hidden');rhythmPanel.classList.add('hidden');document.querySelector('#results-panel').classList.add('hidden');document.querySelector('#stage').classList.remove('rhythm-active');if(id==='drums')buildDrums();else if(id==='piano')buildPiano();else if(current.kind==='strings')buildStrings(id);else buildWind(id);loadInstrument(id);window.scrollTo({top:0,behavior:'smooth'});
  if(appFlow!=='free')openSongPicker();
}
function recordInstrumentSelection(id){if(!playerProgress.stats.instrumentsUsed.includes(id))playerProgress.stats.instrumentsUsed.push(id);savePlayerProgress();if(playerProgress.stats.instrumentsUsed.length>=5)unlockAchievement('instrument-explorer')}
function leaveInstrument(){stopRhythmGame('');stopPlayback();player.classList.add('hidden');player.classList.remove('rhythm-playing');player.removeAttribute('data-instrument');document.querySelector('#song-picker').classList.add('hidden');rhythmPanel.classList.add('hidden');document.querySelector('#results-panel').classList.add('hidden');document.querySelector('#stage').classList.remove('rhythm-active');if(appFlow==='free'){chooser.classList.remove('hidden');welcome.classList.add('hidden')}else openInstrumentChooser(appFlow);window.scrollTo({top:0,behavior:'smooth'})}
function buildSongPicker(){
  const list=document.querySelector('#song-list'),start=document.querySelector('#song-start'),instrument=player.dataset.instrument,previousSongId=appFlow==='level'?null:selectedSong?.id;list.replaceChildren();start.disabled=true;selectedSong=null;
  const songContext=document.querySelector('#song-context'),title=document.querySelector('#song-picker-title'),label=document.querySelector('#song-instrument-label'),practiceCheck=document.querySelector('#practice-mode-picker');practiceCheck.checked=!!playerProgress.settings.practiceMode;
  if(appFlow==='level'&&selectedLevelNumber){const level=levelCatalog[selectedLevelNumber-1],base=musicLibrary.find(song=>song.id===level.song);songContext.textContent=`LEVEL ${selectedLevelNumber} · TARGET ${level.target.toLocaleString()}`;title.textContent=`${base.name} · ${level.difficulty}`;selectedSong={...base,bpm:level.bpm,level:selectedLevelNumber,target:level.target};}
  else if((appFlow==='library-picked'||appFlow==='rhythm-picked')&&selectedLibrarySongId){selectedSong=musicLibrary.find(song=>song.id===selectedLibrarySongId)||null;songContext.textContent=appFlow==='rhythm-picked'?'RHYTHM MODE':'SONG LIBRARY';title.textContent=selectedSong?.name||'Choose a song'}
  else{songContext.textContent=appFlow==='library'?'SONG LIBRARY':'RHYTHM MODE';title.textContent='Choose a song';selectedSong=musicLibrary.find(song=>song.id===previousSongId)||null}
  label.textContent=`Playing ${info[instrument]?.name||'instrument'}${instrument==='clarinet'?' · use combined clarinet fingering keys':''}`;
  const songs=(appFlow==='level'&&selectedLevelNumber)||appFlow==='library-picked'||appFlow==='rhythm-picked'?[selectedSong]:musicLibrary;
  songs.forEach(song=>{if(!song)return;const isSelected=selectedSong?.id===song.id;const card=document.createElement('button');card.type='button';card.className=`song-card${isSelected?' selected':''}`;const name=document.createElement('strong'),meta=document.createElement('span'),description=document.createElement('span'),record=document.createElement('span');name.textContent=song.name;meta.textContent=`${song.bpm} BPM · ${song.difficulty} · ${niceLength(song)}`;description.textContent=song.description;const key=`${instrument}:${song.id}`;record.textContent=`Best ${Number(playerProgress.bestScores[key]||0).toLocaleString()} · ${'★'.repeat(playerProgress.songStars[song.id]||0)}${'☆'.repeat(3-(playerProgress.songStars[song.id]||0))}`;card.append(name,meta,description,record);card.addEventListener('click',()=>{selectedSong=song;list.querySelectorAll('.song-card').forEach(item=>item.classList.toggle('selected',item===card));start.disabled=false});list.append(card)});
  if(selectedSong)start.disabled=false;
}
function visiblePlayableNotes(instrument){
  if(instrument==='piano')return notes.piano.map(row=>row[2]);if(instrument==='guitar')return notes.guitar.flatMap(([,base])=>Array.from({length:25},(_,fret)=>Math.round(69+12*Math.log2(base/440))+fret));if(instrument==='violin')return notes.violin.flatMap(([,base])=>{const root=Math.round(69+12*Math.log2(base/440));return [root,...violinPositionStarts.flatMap(start=>violinFingerOffsets.map(offset=>root+start+offset))]});if(instrument==='flute')return notes.flute.map(row=>row[1]);if(instrument==='clarinet')return notes.clarinet.map(row=>row[1]-2);return [];
}
function lanePitches(instrument){if(instrument==='drums')return Object.entries(drumUrls).map(([part])=>({part,label:part==='hat'?'Hi-hat':part==='hatOpen'?'Open hat':part==='snareSnap'?'Snare snap':part.replace(/([A-Z])/g,' $1').replace(/^./,letter=>letter.toUpperCase())}));const preferred=rhythmPitchLanes[instrument]||[];const supported=new Set(visiblePlayableNotes(instrument));const lanes=preferred.filter(midi=>supported.has(midi));return lanes.length>=3?lanes:preferred}
function updateRhythmStats(){
  if(!rhythmState)return;const state=rhythmState;document.querySelector('#game-score').textContent=String(state.score);document.querySelector('#game-combo').textContent=String(state.combo);document.querySelector('#game-highest').textContent=String(state.highestCombo);document.querySelector('#game-perfect').textContent=String(state.perfect);document.querySelector('#game-good').textContent=String(state.good);document.querySelector('#game-misses').textContent=String(state.misses);document.querySelector('#game-accuracy').textContent=state.judged?`${Math.round(state.hits/state.judged*100)}%`:'—';
}
function rhythmInputKey(event){
  const state=rhythmState;if(event.code==='Space'&&(state?.instrument==='clarinet'||state?.instrument==='flute'))return;if(!state||state.pausedAt!==null||!['keydown'].includes(event.type)||event.repeat||event.ctrlKey||event.altKey||event.metaKey)return;const target=event.target;if(target instanceof Element&&target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]'))return;
  if(event.code==='Space'){event.preventDefault();toggleRhythmPause();return}if(state.instrument==='clarinet')return;const key=event.key,number=key==='0'?9:Number(key)-1;if(!Number.isInteger(number)||number<0||number>=state.lanes.length)return;event.preventDefault();const lane=state.lanes[number];if(state.instrument==='drums')playDrum(lane.part);else playInstrumentNote(state.instrument,lane,.24,'Rhythm keyboard lane');
}
function startRhythmGame(){
  if(!selectedSong){document.querySelector('#game-feedback').textContent='Choose a song first';return}stopRhythmGame('');stopPlayback();const instrument=player.dataset.instrument;if(!instrument){document.querySelector('#game-feedback').textContent='Choose an instrument first';return}const song=selectedSong,startButton=document.querySelector('#song-start');startButton.disabled=true;startButton.textContent='Starting…';document.querySelector('#sound-caption').textContent='Starting audio…';void loadInstrument(instrument).catch(error=>{console.warn('Instrument samples failed; built-in tones remain available',error);document.querySelector('#sound-caption').textContent=`Built-in ${instrument} sound active`});void ensureAudioReady().then(audioReady=>{if(!audioReady)setAudioStatus('error','Audio unavailable · check browser audio permissions')});const effectiveBpm=song.bpm*(playerProgress.settings.practiceMode?0.75:1),lanes=lanePitches(instrument),events=[];let ordinal=0;
  const sequence=instrument==='drums'?drumSongCharts[song.id]:song.pattern;sequence.forEach((value,index)=>{if(value===null)return;const degrees=Array.isArray(value)?value:[value];(monophonicInstruments.has(instrument)||instrument==='drums'?degrees.slice(0,1):degrees).forEach(degree=>events.push({id:ordinal++,lane:instrument==='drums'?degree:((degree%lanes.length)+lanes.length)%lanes.length,beat:index*song.step,judged:false,el:null}))});
  const totalBeats=song.pattern.length*song.step,backingEvents=[];if(instrument==='drums'){for(let beat=0;beat<totalBeats;beat++)backingEvents.push({beat,parts:beat%4===0?['hat','bass']:beat%4===2?['hat','snare']:['hat'],played:false})}else for(let beat=0;beat<totalBeats;beat+=4)backingEvents.push({beat,root:song.chords[Math.floor(beat/4)%song.chords.length],played:false});
  const startAt=performance.now()+3100;rhythmState={instrument,lanes,events,backingEvents,startAt,leadInMs:900,pausedAt:null,score:0,combo:0,highestCombo:0,perfect:0,good:0,hits:0,misses:0,judged:0,bpm:effectiveBpm,stepBeats:song.step};
  document.querySelector('#game-song-title').textContent=song.name;document.querySelector('#game-tempo').textContent=`${Math.round(effectiveBpm)} BPM${playerProgress.settings.practiceMode?' · Practice speed':''} · ${song.difficulty}`;document.querySelector('#game-score').textContent='0';document.querySelector('#game-combo').textContent='0';document.querySelector('#game-highest').textContent='0';document.querySelector('#game-perfect').textContent='0';document.querySelector('#game-good').textContent='0';document.querySelector('#game-misses').textContent='0';document.querySelector('#game-accuracy').textContent='—';document.querySelector('#game-feedback').textContent='Get ready';document.querySelector('#game-target').textContent=song.level?`Target ${song.target.toLocaleString()}`:'';document.querySelector('#game-pause').textContent='Pause';document.querySelector('#song-progress').value=0;document.querySelector('#progress-label').textContent='0%';document.querySelector('#countdown-overlay').classList.remove('hidden');
  const track=document.querySelector('#note-track'),laneBox=document.querySelector('#game-lanes');track.style.setProperty('--lanes',lanes.length);laneBox.style.setProperty('--lanes',lanes.length);track.querySelectorAll('.falling-note').forEach(el=>el.remove());laneBox.replaceChildren();
  lanes.forEach((lane,index)=>{const button=document.createElement('button');button.type='button';button.className=`game-lane${instrument==='clarinet'?' reference-lane':''}`;button.textContent=instrument==='drums'?lane.label:instrument==='clarinet'?`${pitchName(lane)} · ${pitchName(lane+2)} written`:pitchName(lane);button.setAttribute('aria-label',instrument==='clarinet'?`Clarinet note lane ${pitchName(lane)}, play using the matching clarinet fingering`:instrument==='drums'?`Play ${lane.label}`:`Play ${pitchName(lane)}`);if(instrument==='clarinet'){button.disabled=true;button.title='Use the clarinet key combinations to play';}else wirePlay(button,()=>instrument==='drums'?playDrum(lane.part):playInstrumentNote(instrument,lane,.24,'Rhythm lane'));laneBox.append(button)});
  document.querySelector('#game-key-hint').textContent=instrument==='clarinet'?'Use the clarinet model or its keyboard key combinations. Each complete fingering plays and scores its written note.':`Keyboard lanes: ${lanes.map((lane,index)=>`${index===9?'0':index+1}=${instrument==='drums'?lane.label:pitchName(lane)}`).join(' · ')} · click or tap a lane`;
  startButton.disabled=false;startButton.textContent='Start song';document.querySelector('#song-picker').classList.add('hidden');player.classList.add('rhythm-playing');rhythmPanel.classList.remove('hidden');document.querySelector('#results-panel').classList.add('hidden');document.querySelector('#stage').classList.add('rhythm-active');
  events.forEach(event=>{const note=document.createElement('span');note.className=`falling-note${instrument==='drums'?' drum-note':''}`;note.style.left=`${(event.lane+.5)*100/lanes.length}%`;note.setAttribute('aria-hidden','true');event.el=note;track.append(note)});window.scrollTo({top:0,behavior:'smooth'});rhythmRaf=requestAnimationFrame(renderRhythmFrame);
}
function launchRhythmGame(){try{startRhythmGame()}catch(error){console.error('The rhythm song could not start',error);stopRhythmGame('Could not start · try again');player.classList.remove('rhythm-playing');rhythmPanel.classList.add('hidden');document.querySelector('#song-picker').classList.remove('hidden');const button=document.querySelector('#song-start');button.textContent='Start song';button.disabled=!selectedSong;document.querySelector('#sound-caption').textContent='Could not start song · tap Start song to retry';setAudioStatus('error','Game could not start')}}
function renderRhythmFrame(now){
  if(!rhythmState)return;try{const state=rhythmState,elapsed=now-state.startAt,track=document.querySelector('#note-track'),height=track.clientHeight,hitY=height-27,approach=1900,secondsPerBeat=60/state.bpm,totalBeats=selectedSong.pattern.length*selectedSong.step,songDuration=totalBeats*secondsPerBeat*1000,leadInMs=state.leadInMs||0,overlay=document.querySelector('#countdown-overlay');
  if(elapsed<0){const remaining=-elapsed;overlay.textContent=remaining>2000?'3':remaining>1000?'2':'1';overlay.classList.remove('hidden')}else if(elapsed<500){overlay.textContent='GO';overlay.classList.remove('hidden')}else overlay.classList.add('hidden');
  for(const backing of state.backingEvents)if(!backing.played&&elapsed>=leadInMs+backing.beat*secondsPerBeat*1000){backing.played=true;playSongBacking(state,backing)}
  for(const event of state.events){if(event.judged)continue;const hitAt=leadInMs+event.beat*secondsPerBeat*1000;if(elapsed>hitAt+165){event.judged=true;event.el?.remove();state.misses++;state.combo=0;state.judged++;document.querySelector('#game-feedback').textContent='Miss';updateRhythmStats();continue}const y=hitY-((hitAt-elapsed)/approach)*hitY;event.el.style.top=`${Math.max(-20,Math.min(height+20,y))}px`;event.el.style.opacity=(y< -10||y>height+10)?'0':'1';event.el.classList.toggle('near-hit',Math.abs(hitAt-elapsed)<100)}
  const progress=Math.max(0,Math.min(100,(elapsed-leadInMs)/songDuration*100));document.querySelector('#song-progress').value=progress;document.querySelector('#progress-label').textContent=`${Math.round(progress)}%`;if(elapsed>leadInMs+songDuration+250){finishRhythmGame('Song complete');return}rhythmRaf=requestAnimationFrame(renderRhythmFrame)}catch(error){console.error('Rhythm game frame failed',error);document.querySelector('#countdown-overlay').classList.add('hidden');stopRhythmGame('Game paused · restart to continue')}
}
function judgeRhythmInput(instrument,midi,drumPart=null){
  const state=rhythmState;if(!state||state.instrument!==instrument||state.pausedAt!==null)return;const elapsed=performance.now()-state.startAt-(state.leadInMs||0),beatMs=60000/state.bpm,windowMs=165;const unresolved=state.events.filter(event=>!event.judged),nearest=unresolved.map(event=>({event,error:Math.abs(event.beat*beatMs-elapsed)})).filter(item=>item.error<=windowMs).sort((a,b)=>a.error-b.error);const correct=nearest.find(({event})=>instrument==='drums'?state.lanes[event.lane].part===drumPart:state.lanes[event.lane]===midi);
  if(!correct){if(nearest.length){const wrong=nearest[0].event;wrong.judged=true;wrong.el?.remove();state.misses++;state.judged++;state.combo=0;document.querySelector('#game-feedback').textContent='Miss';updateRhythmStats()}else{document.querySelector('#game-feedback').textContent='Try again';state.combo=0;updateRhythmStats()}return}
  const {event,error}=correct;event.judged=true;event.el?.remove();state.judged++;state.hits++;state.combo++;state.highestCombo=Math.max(state.highestCombo,state.combo);const perfect=error<=65;if(perfect){state.perfect++;state.score+=300+Math.min(state.combo,50)*5;playerProgress.stats.totalPerfectHits++;if(playerProgress.stats.totalPerfectHits>=10)unlockAchievement('perfect-start')}else{state.good++;state.score+=120+Math.min(state.combo,50)*2}playerProgress.stats.highestCombo=Math.max(playerProgress.stats.highestCombo,state.highestCombo);if(state.highestCombo>=20)unlockAchievement('combo-master');document.querySelector('#game-feedback').textContent=perfect?'Perfect':'Good';document.querySelectorAll('.game-lane')[event.lane]?.classList.add('playing');window.setTimeout(()=>document.querySelectorAll('.game-lane')[event.lane]?.classList.remove('playing'),130);updateRhythmStats();savePlayerProgress();
}
function finishRhythmGame(message){
  if(!rhythmState)return;const finishedState=rhythmState;cancelAnimationFrame(rhythmRaf);rhythmRaf=0;rhythmState=null;stopPlayback();document.querySelector('#game-feedback').textContent=message;document.querySelector('#game-pause').textContent='Pause';document.querySelector('#countdown-overlay').classList.add('hidden');
  if(message==='Song complete'){const judged=finishedState.hits+finishedState.misses,accuracy=judged?finishedState.hits/judged:0,stars=accuracy>=.95?3:accuracy>=.8?2:accuracy>=.6?1:0,key=`${finishedState.instrument}:${selectedSong.id}`,previous=Number(playerProgress.bestScores[key]||0);playerProgress.bestScores[key]=Math.max(previous,finishedState.score);playerProgress.songStars[selectedSong.id]=Math.max(Number(playerProgress.songStars[selectedSong.id]||0),stars);playerProgress.stats.songsCompleted++;if(finishedState.instrument==='clarinet')playerProgress.stats.clarinetSongs++;unlockAchievement('first-song');if(playerProgress.stats.clarinetSongs>=5)unlockAchievement('clarinet-master');if(stars===3)unlockAchievement('three-star-player');
    let reward='Song saved to your library.';if(selectedSong.level){const levelNo=selectedSong.level;playerProgress.completedLevels=Array.from(new Set([...playerProgress.completedLevels,levelNo])).sort((a,b)=>a-b);playerProgress.bestScores[`level-${levelNo}`]=Math.max(Number(playerProgress.bestScores[`level-${levelNo}`]||0),finishedState.score);if(finishedState.score>=selectedSong.target){const next=levelNo+1;if(next<=10&&!playerProgress.unlockedLevels.includes(next))playerProgress.unlockedLevels.push(next);reward=levelNo===10?'All levels complete!':`Target reached · Level ${Math.min(10,next)} ${next<=10?'unlocked':'complete'}`}else reward=`Target ${selectedSong.target.toLocaleString()} not reached yet · replay this level to unlock the next`;
      const count=playerProgress.completedLevels.length;if(count>=3)unlockAchievement('music-beginner');if(count>=5)unlockAchievement('rising-musician');if(count>=10)unlockAchievement('music-expert');renderLevels()}
    savePlayerProgress();renderResults({score:finishedState.score,combo:finishedState.highestCombo,perfect:finishedState.perfect,good:finishedState.good,misses:finishedState.misses,accuracy,stars,reward});
  }
}
function renderResults(result){
  document.querySelector('#results-title').textContent=selectedSong?.name?`${selectedSong.name} · complete`:'Song complete';document.querySelector('#results-stars').textContent='★'.repeat(result.stars)+'☆'.repeat(3-result.stars);document.querySelector('#results-stats').innerHTML=`<span>Score <b>${result.score.toLocaleString()}</b></span><span>Highest combo <b>${result.combo}</b></span><span>Perfect <b>${result.perfect}</b></span><span>Good <b>${result.good}</b></span><span>Misses <b>${result.misses}</b></span><span>Accuracy <b>${Math.round(result.accuracy*100)}%</b></span>`;document.querySelector('#results-reward').textContent=result.reward;document.querySelector('#results-panel').classList.remove('hidden');rhythmPanel.classList.add('hidden');
}
function stopRhythmGame(message='Stopped'){rhythmStartToken++;if(!rhythmState)return;cancelAnimationFrame(rhythmRaf);rhythmRaf=0;rhythmState=null;stopPlayback();document.querySelector('#game-feedback').textContent=message||'Ready';document.querySelector('#countdown-overlay').classList.add('hidden');document.querySelector('#game-pause').textContent='Pause'}
function setRhythmPaused(shouldPause){
  if(!rhythmState)return;const state=rhythmState,alreadyPaused=state.pausedAt!==null;if(shouldPause===alreadyPaused)return;const now=performance.now();
  if(shouldPause){state.pausedAt=now;cancelAnimationFrame(rhythmRaf);rhythmRaf=0;stopPlayback();void audio?.suspend().catch(error=>console.warn('Audio pause failed',error));const overlay=document.querySelector('#countdown-overlay');overlay.textContent='Paused';overlay.classList.remove('hidden');document.querySelector('#game-pause').textContent='Resume';document.querySelector('#game-feedback').textContent='Paused'}
  else{state.startAt+=now-state.pausedAt;state.pausedAt=null;void audio?.resume().catch(error=>{setAudioStatus('error','Audio blocked · interact to retry');console.warn('Audio resume failed',error)});document.querySelector('#game-pause').textContent='Pause';document.querySelector('#game-feedback').textContent='Playing';rhythmRaf=requestAnimationFrame(renderRhythmFrame)}
}
function toggleRhythmPause(){if(rhythmState)setRhythmPaused(rhythmState.pausedAt===null)}
function exitRhythmGame(toSongs=true){
  stopRhythmGame('');player.classList.remove('rhythm-playing');rhythmPanel.classList.add('hidden');document.querySelector('#results-panel').classList.add('hidden');document.querySelector('#stage').classList.remove('rhythm-active');if(toSongs){document.querySelector('#song-picker').classList.remove('hidden');buildSongPicker()}else document.querySelector('#song-picker').classList.add('hidden');window.scrollTo({top:0,behavior:'smooth'});
}
function backFromSongPicker(){
  stopRhythmGame('');document.querySelector('#song-picker').classList.add('hidden');document.querySelector('#results-panel').classList.add('hidden');document.querySelector('#stage').classList.remove('rhythm-active');leaveInstrument();
}
function setupMainNavigation(){
  document.querySelectorAll('[data-menu="levels"]').forEach(button=>button.addEventListener('click',openLevelsPage));
  document.querySelectorAll('[data-page]').forEach(button=>button.addEventListener('click',()=>{stopRhythmGame('');stopPlayback();welcome.classList.add('hidden');chooser.classList.add('hidden');player.classList.add('hidden');hideHomeSubpages();const page=document.getElementById(button.dataset.page);page.classList.remove('hidden');if(button.dataset.page==='achievements-page')renderAchievements()}));
  document.querySelectorAll('[data-home]').forEach(button=>button.addEventListener('click',showMainMenu));document.querySelector('.brand').addEventListener('click',event=>{event.preventDefault();showMainMenu()});
  document.querySelector('#start-button').addEventListener('click',openPlayModesPage);
  document.querySelectorAll('[data-play-mode]').forEach(button=>button.addEventListener('click',()=>{if(button.dataset.playMode==='rhythm')openRhythmPage();else if(button.dataset.playMode==='library')openLibraryPage();else openInstrumentChooser('free')}));
  document.querySelector('#chooser-back').addEventListener('click',handleChooserBack);
  document.querySelector('#song-start').addEventListener('click',launchRhythmGame);
  document.querySelector('#song-back').addEventListener('click',backFromSongPicker);document.querySelector('#results-replay').addEventListener('click',launchRhythmGame);document.querySelector('#results-library').addEventListener('click',openLibraryPage);
  document.querySelector('#game-back').addEventListener('click',()=>exitRhythmGame(true));document.querySelector('#game-pause').addEventListener('click',toggleRhythmPause);document.querySelector('#game-restart').addEventListener('click',launchRhythmGame);document.querySelector('#game-stop').addEventListener('click',()=>{stopPlayback();setRhythmPaused(true);document.querySelector('#game-feedback').textContent='Stopped'});
  document.querySelector('#practice-mode').addEventListener('change',event=>updatePracticeSetting(event.target.checked));document.querySelector('#practice-mode-picker').addEventListener('change',event=>updatePracticeSetting(event.target.checked));
  document.querySelector('#settings-volume').addEventListener('input',event=>{const volume=Number(event.target.value);playerProgress.settings.volume=volume;document.querySelector('#volume-slider').value=String(volume);if(master&&audio)master.gain.setTargetAtTime(volume/100,audio.currentTime,.025);savePlayerProgress()});
  document.querySelector('#volume-slider').addEventListener('input',event=>{const volume=Number(event.target.value);playerProgress.settings.volume=volume;document.querySelector('#settings-volume').value=String(volume);if(master&&audio)master.gain.setTargetAtTime(volume/100,audio.currentTime,.025);savePlayerProgress()});
  document.querySelector('#reset-progress').addEventListener('click',()=>{if(!window.confirm('Reset all saved levels, scores, achievements, and settings?'))return;Object.assign(playerProgress,progressDefaults());savePlayerProgress();applySavedSettings();renderLevels();renderAchievements();document.querySelector('#settings-status').textContent='Saved progress has been reset.'});
  document.addEventListener('keydown',event=>{if(event.code!=='Space'||event.repeat||document.querySelector('#song-picker').classList.contains('hidden')||!selectedSong)return;const target=event.target;if(target instanceof Element&&target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]'))return;if(target instanceof Element&&target.id==='song-start')return;event.preventDefault();launchRhythmGame()});
  document.addEventListener('keydown',rhythmInputKey);
}
applySavedSettings();renderAchievements();renderLevels();buildSongPicker();setupMainNavigation();

