const chooser=document.querySelector('#chooser');
const welcome=document.querySelector('#welcome');
const player=document.querySelector('#player');
const controls=document.querySelector('#controls');
const art=document.querySelector('#instrument-art');
const audioContext=window.AudioContext||window.webkitAudioContext;
let audio=null,master=null,limiter=null,nextStickingHand='R';
const activeSources=new Set(),activeVoices=new Set(),instrumentVoices=new Map();
const activeControls=new Set(),controlHeld=new WeakMap(),heldPianoKeys=new Map(),selectedGuitarFrets=new Map(),selectedViolinNotes=new Map();let clearWindControls=()=>{},clearInstrumentKeyboard=()=>{};
const keyboardFeedbackKeys=new Map(),feedbackVoices=new Set();
let guitarKeyboardKeydown=()=>{},guitarKeyboardKeyup=()=>{},drumKeyboardKeydown=()=>{},drumKeyboardKeyup=()=>{},violinKeyboardKeydown=()=>{},violinKeyboardKeyup=()=>{},currentClarinetKeyboardMode='notes',currentViolinKeyboardMode='easy';
let composerSession=null;const composerPlaybackTimers=new Set();
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
  if(!voice||voice.stopped)return;if(voice.pending){voice.stopped=true;if(voice.actual)stopVoice(voice.actual,immediate,fadeTime);const queue=pendingNotes[voice.instrument];if(queue)pendingNotes[voice.instrument]=queue.filter(note=>note!==voice);return}if(voice.composerEvent&&Number.isFinite(voice.composerStartedAt))voice.composerEvent.durationBeats=Math.max(.125,((audio?.currentTime||voice.composerStartedAt)-voice.composerStartedAt)*Number(voice.composerBpm||120)/60);voice.stopped=true;forgetFeedbackVoice(voice);
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
  for(const control of activeControls){control.classList.remove('playing');controlHeld.delete(control)}activeControls.clear();heldPianoKeys.clear();clearKeyboardFeedback();
}
function stopPlayback(){stopComposerPlayback();stopSheetPlayback();for(const [instrument,queue] of Object.entries(pendingNotes)){queue.forEach(note=>stopVoice(note,true));delete pendingNotes[instrument]}pendingDrums.length=0;stopSounds();clearHeldControls();clearWindControls();clearInstrumentKeyboard()}async function loadBuffer(url){
  if(!sampleCache.has(url)){const request=(async()=>{const response=await fetch(url,{mode:'cors',cache:'force-cache'});if(!response.ok)throw new Error(`Sample request failed (${response.status}): ${url}`);return audio.decodeAudioData(await response.arrayBuffer())})();sampleCache.set(url,request);request.catch(()=>{if(sampleCache.get(url)===request)sampleCache.delete(url)})}
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
    const buffers=new Map();instrumentBuffers[instrument]=buffers;loadingInstruments.add(instrument);const preferred={piano:[48,60,72,84,96],guitar:[40,45,52,57,64,69],violin:[55,64,72,81,91],flute:[60,72,84,96],clarinet:[50,58,65,74,82,90]},primary=instrument==='drums'?anchors:preferred[instrument].map(midi=>anchors.find(([key])=>key===midi)).filter(Boolean);
    const loadBatch=async(batch)=>{const results=await Promise.allSettled(batch.map(async([key,url])=>[key,await loadBuffer(url)]));let failed=0;results.forEach(result=>{if(result.status==='fulfilled')buffers.set(...result.value);else{failed++;console.warn('Instrument sample unavailable',result.reason)}});return failed};
    const primaryFailed=await loadBatch(primary);loadingInstruments.delete(instrument);flushPendingNotes(instrument);
    if(player.dataset.instrument===instrument){document.querySelector('#sound-caption').textContent=primaryFailed?`${info[instrument].caption} · backup tone ready; samples loading`:'Quick samples ready · loading the full range';if(primaryFailed)setAudioStatus('fallback','Audio enabled · backup instrument sound active')}
    const primaryUrls=new Set(primary.map(([,url])=>url)),remaining=anchors.filter(([,url])=>!primaryUrls.has(url));if(remaining.length)void loadBatch(remaining).then(failed=>{if(failed&&player.dataset.instrument===instrument){document.querySelector('#sound-caption').textContent=`Some samples unavailable · built-in ${instrument} sound covers missing notes`;setAudioStatus('fallback','Audio enabled · backup instrument sound active')}});
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
  source.addEventListener('ended',()=>{activeVoices.delete(voice);instrumentVoices.get(instrument)?.delete(voice);forgetFeedbackVoice(voice);try{source.disconnect();gain.disconnect();toneNodes.forEach(node=>node.disconnect())}catch{}},{once:true});source.start(startAt===null?ctx.currentTime:startAt);return voice;
}
const fallbackHarmonics={piano:[1,.56,.34,.22,.15,.1,.07,.05,.035],guitar:[1,.72,.48,.32,.22,.15,.1,.065,.04],violin:[1,.78,.62,.48,.38,.29,.22,.17,.12,.09],flute:[1,.08,.28,.035,.12,.02,.06,.012],clarinet:[1,0,.7,0,.43,0,.27,0,.17,0,.1]};
function registerFallbackVoice(sources,gain,instrument,toneNodes=[]){
  const voice={source:sources[0],sources,gain,instrument,toneNodes,stopped:false};activeVoices.add(voice);if(instrument){if(!instrumentVoices.has(instrument))instrumentVoices.set(instrument,new Set());instrumentVoices.get(instrument).add(voice)}let remaining=sources.length;const cleanup=()=>{if(--remaining>0)return;activeVoices.delete(voice);instrumentVoices.get(instrument)?.delete(voice);forgetFeedbackVoice(voice);try{gain.disconnect();toneNodes.forEach(node=>node.disconnect())}catch{}};sources.forEach(source=>{track(source,instrument);source.addEventListener('ended',cleanup,{once:true})});return voice;
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
function playMetronomeClick(accent=false){const ctx=initAudio();if(!ctx||!master)return null;const now=ctx.currentTime,osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='sine';osc.frequency.setValueAtTime(accent?1450:1050,now);gain.gain.setValueAtTime(.0001,now);gain.gain.linearRampToValueAtTime(accent?0.13:0.085,now+.003);gain.gain.exponentialRampToValueAtTime(.0001,now+.055);osc.connect(gain);gain.connect(master);const voice=registerFallbackVoice([osc],gain,'metronome');osc.start(now);osc.stop(now+.06);return voice}
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
  const compositionEvent=judge?recordCompositionEvent(instrument,{kind:'note',midi:targetMidi}):null;
  if(judge)judgeRhythmInput(instrument,targetMidi);
  const monophonic=monophonicInstruments.has(instrument);
  if(monophonic){stopInstrumentSounds(instrument,instrument==='clarinet'?false:true,instrument==='clarinet' ? .001 : .11);for(const note of pendingNotes[instrument]||[])stopVoice(note,true);pendingNotes[instrument]=[]}
  showNoteInfo(instrument,targetMidi,control||`Note ${instrument==='clarinet'?pitchName(targetMidi+2):pitchName(targetMidi)}`);
  const finishRhythmVoice=voice=>{if(voice){rememberFeedbackVoice(voice,instrument,targetMidi);if(compositionEvent){voice.composerEvent=compositionEvent;voice.composerStartedAt=audio?.currentTime||0;voice.composerBpm=composerSession?.bpm||120}}const state=rhythmState;if(voice&&state?.instrument===instrument){const slotDuration=(state.stepBeats||.5)*60/(state.bpm||selectedSong?.bpm||120)*.9,duration=instrument==='clarinet'?Math.max(.42,slotDuration):slotDuration;window.setTimeout(()=>stopVoice(voice),duration*1000)}return voice};
  const buffers=instrumentBuffers[instrument];
  if(!buffers?.size){document.querySelector('#sound-caption').textContent=`${info[instrument].caption} · built-in ${instrument} sound`;return finishRhythmVoice(playFallbackNote(instrument,targetMidi,level))}
  const anchor=nearestAnchor(instrument,targetMidi);if(instrument==='clarinet'&&Math.abs(targetMidi-anchor)>3){document.querySelector('#sound-caption').textContent=`Using built-in clarinet tone for ${pitchName(targetMidi)}`;return finishRhythmVoice(playFallbackNote(instrument,targetMidi,level))}const buffer=buffers.get(anchor);
  if(!buffer){document.querySelector('#sound-caption').textContent=`Using built-in ${instrument} sound for ${pitchName(targetMidi)}`;return finishRhythmVoice(playFallbackNote(instrument,targetMidi,level))}
  return finishRhythmVoice(playBuffer(buffer,2**((targetMidi-anchor)/12),level,instrument));
}function playDrum(part,judge=true,dynamicGain=1){
  if(judge)recordPlayerAction('drums');
  if(judge)recordCompositionEvent('drums',{kind:'drum',part});
  if(judge)judgeRhythmInput('drums',null,part);
  const drumLabel=part==='hat'?'Closed hi-hat':part==='hatOpen'?'Open hi-hat':part==='bass'?'Bass drum':part==='snare'?'Snare':part==='snareSnap'?'Snare snap':part.replace(/([A-Z])/g,' $1');
  const sticking=part==='bass'?'Foot':part==='hat'||part==='hatOpen'?'Right hand or foot':nextStickingHand==='R'?'Right hand':'Left hand';
  if(part!=='bass'&&part!=='hat'&&part!=='hatOpen')nextStickingHand=nextStickingHand==='R'?'L':'R';
  document.querySelector('#note-info').textContent=`Drums · ${drumLabel} · percussion pad · Suggested: ${sticking}`;
  const showDrum=voice=>rememberFeedbackVoice(voice,'drums',null,drumLabel),buffers=instrumentBuffers.drums;if(!buffers?.size){document.querySelector('#sound-caption').textContent='Drum samples loading · built-in percussion sound active';return showDrum(playFallbackDrum(part,.38*dynamicGain))}
  const buffer=buffers.get(part);if(!buffer){document.querySelector('#sound-caption').textContent=`Built-in percussion sound active for ${drumLabel}`;return showDrum(playFallbackDrum(part,.38*dynamicGain))}
  return showDrum(playBuffer(buffer,1,.32*dynamicGain));
}function hitDrum(part){return playDrum(part)}
function flash(button){button.classList.add('playing');window.setTimeout(()=>button.classList.remove('playing'),260)}
function makeButton(label,cls=''){const b=document.createElement('button');b.type='button';b.className=cls;b.textContent=label;b.setAttribute('aria-label',`Play ${label}`);return b}
function isTypingTarget(target){return target instanceof Element&&!!target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]')}
function addComputerKeyLabel(control,key){const label=document.createElement('kbd');label.className='computer-key-label';label.textContent=key;label.setAttribute('aria-hidden','true');control.append(label);return label}
function buildKeyboardGuide(entries,{open=false,title='Computer keyboard guide'}={}){const details=document.createElement('details');details.className='clarinet-keyboard-guide instrument-keyboard-guide';details.open=open;const summary=document.createElement('summary');summary.textContent=title;const list=document.createElement('div');list.className='clarinet-keyboard-list';entries.forEach(([keyName,descriptionText])=>{const row=document.createElement('div');row.className='clarinet-keyboard-row';const cap=document.createElement('kbd');cap.textContent=keyName;const description=document.createElement('span');description.textContent=descriptionText;row.append(cap,description);list.append(row)});details.append(summary,list);return details}
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
  const keyByMidi=new Map();Object.entries(pianoKeyMap).forEach(([key,midi])=>keyByMidi.set(midi,key.length===1?key.toUpperCase():key));
  white.forEach(([label,,midi])=>{const b=makeButton(midi%12===0?label:'','white-key');b.setAttribute('aria-label',`Play ${label}`);b.title=label;const computerKey=keyByMidi.get(midi);if(computerKey)addComputerKeyLabel(b,computerKey);wirePlay(b,()=>playInstrumentNote('piano',midi,.24,'Piano key'),{release:true});keys.appendChild(b)});
  black.forEach(([label,,midi])=>{const b=makeButton('','black-key');b.style.left=`${(positions.get(midi-1)+1)*whiteWidth-blackWidth/2}px`;b.setAttribute('aria-label',`Play ${label}`);b.title=label;const computerKey=keyByMidi.get(midi);if(computerKey)addComputerKeyLabel(b,computerKey);wirePlay(b,()=>playInstrumentNote('piano',midi,.24,'Piano key'),{release:true});keys.appendChild(b)});
   const hint=document.createElement('p');hint.className='key-hint';hint.textContent='C–B plays natural notes C4–B4 · Full 88-key range · scroll to explore';
   const guide=buildKeyboardGuide(Object.entries(pianoKeyMap).map(([key,midi])=>[key.length===1?key.toUpperCase():key,pitchName(midi)]));
  guide.querySelector('.clarinet-keyboard-list').append((()=>{const row=document.createElement('div');row.className='clarinet-keyboard-row';row.innerHTML='<kbd>Space</kbd><span>Stop active sounds.</span>';return row})());
  controls.append(keys,hint,guide);window.requestAnimationFrame(()=>{if(keys.scrollWidth>controls.clientWidth*1.7){const middleC=keys.querySelector('[aria-label="Play C4"]');if(middleC)controls.scrollLeft=Math.max(0,middleC.offsetLeft+middleC.offsetWidth/2-controls.clientWidth/2)}});
}
// C–B are note shortcuts (written C4–B4); the remaining keys operate the
// clarinet's physical controls. T is the left-thumb hole key.
const clarinetNoteKeyboardMap=Object.freeze({KeyC:'C4',KeyD:'D4',KeyE:'E4',KeyF:'F4',KeyG:'G4',KeyA:'A4',KeyB:'B4'});
const fluteNoteKeyboardMap=Object.freeze({KeyC:'C5',KeyD:'D5',KeyE:'E5',KeyF:'F5',KeyG:'G5',KeyA:'A5',KeyB:'B5'});
const clarinetKeyboardMap=Object.freeze({KeyT:'T',KeyW:'R',KeyQ:'L1',KeyS:'L2',KeyH:'L3',KeyN:'R1',KeyM:'R2',KeyV:'R3',KeyJ:'A',KeyK:'G#-side',KeyX:'Eb',KeyU:'E/B-L',KeyI:'F-R',KeyO:'F#-R',KeyP:'C#-L',KeyR:'G#-L',KeyY:'B'});
const clarinetComputerKeyByModelKey=Object.fromEntries(Object.entries(clarinetKeyboardMap).map(([code,modelKey])=>[modelKey,code.replace(/^Key/,'')]));
let clarinetKeyboardKeydown=()=>{},clarinetKeyboardKeyup=()=>{},releaseClarinetKeyboard=()=>{};let fluteKeyboardKeydown=()=>{},fluteKeyboardKeyup=()=>{},releaseFluteKeyboard=()=>{};const pianoKeyMap={z:48,s:49,x:50,'1':51,'4':52,v:53,'8':54,'-':55,h:56,n:57,j:58,m:59,',':60,l:61,'.':62,';':63,'/':64,q:60,2:61,w:62,3:63,e:64,r:65,5:66,t:67,6:68,y:69,7:70,u:71,i:72,9:73,o:74,0:75,p:76,c:60,d:62,e:64,f:65,g:67,a:69,b:71};
const guitarKeyboardMap=Object.freeze({Digit1:0,Digit2:1,Digit3:2,Digit4:3,Digit5:4,Digit6:5});
const guitarNoteKeyboardMap=Object.freeze({KeyC:{stringIndex:4,fret:1,midi:60,label:'C4'},KeyD:{stringIndex:4,fret:3,midi:62,label:'D4'},KeyE:{stringIndex:4,fret:5,midi:64,label:'E4'},KeyF:{stringIndex:4,fret:6,midi:65,label:'F4'},KeyG:{stringIndex:4,fret:8,midi:67,label:'G4'},KeyA:{stringIndex:4,fret:10,midi:69,label:'A4'},KeyB:{stringIndex:4,fret:12,midi:71,label:'B4'}});
const drumKeyboardMap=Object.freeze({KeyA:'hat',KeyS:'snare',KeyD:'bass',KeyF:'tomHigh',KeyG:'tomMid',KeyH:'tomLow',KeyJ:'crash',KeyK:'ride',KeyL:'hatOpen',Semicolon:'snareSnap'});
const violinKeyboardMap=Object.freeze({KeyQ:0,KeyW:1,KeyE:2,KeyR:3});
const violinFingerKeyboardMap=Object.freeze({Digit1:1,Digit2:2,Digit3:3,Digit4:4,Digit0:0});
const violinEasyKeyboardMap=Object.freeze({KeyC:[0,3,'C4'],KeyD:[0,4,'D4'],KeyE:[1,1,'E4'],KeyF:[1,2,'F4'],KeyG:[1,3,'G4'],KeyA:[1,4,'A4'],KeyB:[2,1,'B4']});
function keyboardDisplayLabel(event){if(event.code.startsWith('Key'))return event.code.slice(3);if(event.code.startsWith('Digit'))return event.code.slice(5);return ({Comma:',',Period:'.',Semicolon:';',Slash:'/',Minus:'-'})[event.code]||''}
function isMappedKeyboardInput(instrument,event){const code=event.code;switch(instrument){case'piano':return Object.hasOwn(pianoKeyMap,event.key.toLowerCase());case'guitar':return Object.hasOwn(guitarKeyboardMap,code)||Object.hasOwn(guitarNoteKeyboardMap,code);case'drums':return Object.hasOwn(drumKeyboardMap,code);case'violin':return currentViolinKeyboardMode==='easy'?Object.hasOwn(violinEasyKeyboardMap,code):Object.hasOwn(violinKeyboardMap,code)||Object.hasOwn(violinFingerKeyboardMap,code);case'flute':return Object.hasOwn(fluteNoteKeyboardMap,code)||code==='KeyW';case'clarinet':return currentClarinetKeyboardMode==='notes'?Object.hasOwn(clarinetNoteKeyboardMap,code)||code==='KeyW':Object.hasOwn(clarinetKeyboardMap,code);default:return false}}
function refreshKeyboardFeedback(){const keys=document.querySelector('#keys-pressed'),playing=document.querySelector('#playing-notes'),label=document.querySelector('#playing-label');if(!keys||!playing||!label)return;keys.textContent=[...keyboardFeedbackKeys.values()].join(' + ')||'—';const instrument=player.dataset.instrument;label.textContent=instrument==='drums'?'Playing Sounds':'Playing Notes';playing.textContent=[...new Set([...feedbackVoices].filter(voice=>!voice.stopped&&voice.feedbackLabel).map(voice=>voice.feedbackLabel))].join(' + ')||'—'}
function rememberFeedbackVoice(voice,instrument,midi,labelOverride=''){if(!voice)return voice;voice.feedbackLabel=labelOverride||(instrument==='clarinet'?`Written ${pitchName(midi+2)} · concert ${pitchName(midi)}`:pitchName(midi));feedbackVoices.add(voice);refreshKeyboardFeedback();return voice}
function forgetFeedbackVoice(voice){if(feedbackVoices.delete(voice))refreshKeyboardFeedback()}
function clearKeyboardFeedback(){keyboardFeedbackKeys.clear();refreshKeyboardFeedback()}
function rememberMappedKeyDown(event){if(player.classList.contains('hidden')||isTypingTarget(event.target)||event.repeat||event.ctrlKey||event.altKey||event.metaKey)return;const instrument=player.dataset.instrument,label=keyboardDisplayLabel(event);if(!label||!isMappedKeyboardInput(instrument,event)||keyboardFeedbackKeys.has(event.code))return;keyboardFeedbackKeys.set(event.code,label);refreshKeyboardFeedback()}
function forgetMappedKeyUp(event){if(keyboardFeedbackKeys.delete(event.code))refreshKeyboardFeedback()}
function playFromComputerKey(event){
  if(player.classList.contains('hidden')||player.dataset.instrument!=='piano'||isTypingTarget(event.target)||event.repeat||event.ctrlKey||event.altKey||event.metaKey)return;
  const keyName=event.key.toLowerCase(),midi=pianoKeyMap[keyName];if(!midi||heldPianoKeys.has(keyName))return;
  event.preventDefault();const voice=playInstrumentNote('piano',midi,.24,'Computer key '+keyName.toUpperCase());heldPianoKeys.set(keyName,voice);
  const key=controls.querySelector(`[aria-label="Play ${pitchName(midi)}"]`);if(key){key.classList.add('playing');activeControls.add(key);}
}
function releasePianoComputerKey(event){
  const keyName=event.key.toLowerCase();if(!heldPianoKeys.has(keyName))return;const voice=heldPianoKeys.get(keyName);heldPianoKeys.delete(keyName);if(voice)stopVoice(voice);const midi=pianoKeyMap[keyName],samePitchStillHeld=[...heldPianoKeys.keys()].some(otherKey=>pianoKeyMap[otherKey]===midi),key=controls.querySelector(`[aria-label="Play ${pitchName(midi)}"]`);if(key&&!samePitchStillHeld){key.classList.remove('playing');activeControls.delete(key)}
}function stopActiveSoundsKey(event){if(event.code!=='Space'||event.repeat||player.classList.contains('hidden')||rhythmState||isTypingTarget(event.target)||(event.target instanceof Element&&event.target.closest('button'))||['clarinet','flute'].includes(player.dataset.instrument))return;event.preventDefault();stopPlayback();document.querySelector('#sound-caption').textContent='Playback stopped'}
function renderGuitarSvg(){
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
    ['T',74,329,'back'],['R',118,329,'back'],
    ['L1',220,356,'ring'],['L2',220,416,'ring'],['L3',220,476,'tone'],
    ['R1',220,625,'ring'],['R2',220,685,'ring'],['R3',220,745,'ring'],
    ['A',277,356,'side'],['G#-side',281,411,'side'],['Eb',158,469,'side'],['B',281,536,'side'],
    ['C#-L',151,608,'pinky'],['E/B-L',151,653,'pinky'],['F-L',151,698,'pinky'],['F#-L',151,743,'pinky'],['G#-L',151,788,'pinky'],
    ['E/B-R',289,608,'pinky'],['F-R',289,653,'pinky'],['F#-R',289,698,'pinky'],['G#-R',289,743,'pinky']
  ];
  const actionByKey={'E/B-L':'E/B','E/B-R':'E/B','F-L':'F','F-R':'F','F#-L':'F#','F#-R':'F#','G#-L':'G#','G#-R':'G#','C#-L':'C#'};
  const fingerForKey={T:'Left thumb · thumb hole',R:'Left thumb · register vent',L1:'Left index · ring',L2:'Left middle · ring',L3:'Left ring finger · tone hole',R1:'Right index · ring',R2:'Right middle · ring',R3:'Right ring finger · tone hole',A:'Left index · A key','G#-side':'Left index · side G-sharp key',Eb:'Left little finger · E-flat sliver key',B:'Right little finger · B/F-sharp sliver key','C#-L':'Left little finger · C-sharp/G-sharp key','E/B-L':'Left little finger · low E/B key','F-L':'Left little finger · low F/C key','F#-L':'Left little finger · low F-sharp/C-sharp key','G#-L':'Left little finger · G-sharp/D-sharp key','E/B-R':'Right little finger · low E/B key','F-R':'Right little finger · low F/C key','F#-R':'Right little finger · low F-sharp/C-sharp key','G#-R':'Right little finger · G-sharp/D-sharp key'};
  const keyMarkup=keys.map(([key,x,y,type])=>{
    const computerKey=clarinetComputerKeyByModelKey[key]||'';
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
  const views={Closeup:[18,250,385,650],Full:[0,0,420,1120],Upper:[130,300,220,300],Lower:[130,555,220,305],Thumb:[18,270,150,220]};let view='Full',zoom=1,rotated=false;
  const apply=()=>{const [x,y,w,h]=views[view],nextW=w/zoom,nextH=h/zoom;svg.setAttribute('viewBox',`${x+(w-nextW)/2} ${y+(h-nextH)/2} ${nextW} ${nextH}`);svg.classList.toggle('rotated',rotated);toolbar.querySelectorAll('[data-view]').forEach(button=>{const selected=button.dataset.view===view;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected))});const rotateButton=toolbar.querySelector('.rotate-button');if(rotateButton)rotateButton.setAttribute('aria-pressed',String(rotated))};
  Object.keys(views).forEach(name=>{const button=makeButton(name,'clarinet-view-button');button.dataset.view=name;button.setAttribute('aria-label','View clarinet '+name.toLowerCase()+' section');button.setAttribute('aria-pressed',String(name===view));button.addEventListener('click',()=>{view=name;zoom=1;apply();document.querySelector('#stage').scrollTop=0});toolbar.append(button)});
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
  const pressed=new Set(),heldDirectNoteKeys=new Set();let selectedWrittenMidi=null,highRegister=false,practiceTarget=null,fingerGuide=true,practiceStatus=null,keyboardNote={code:null,label:null,chartLabel:null,voice:null},registerLatched=false,keyboardMode=currentClarinetKeyboardMode,clarinetAccidental='natural',startNoteShortcut=()=>false,setAccidental=()=>{},stopOpenClarinet=()=>{},fluteAccidental='natural',fluteKeyboardNote={code:null,label:null,voice:null},startFluteNoteShortcut=()=>false,setFluteAccidental=()=>{},setFluteRegister=()=>{};
  art.innerHTML=id==='flute'?renderFluteSvg():renderClarinetSvg();
  const clarinetFunctions=new Map([...art.querySelectorAll('.clarinet-key')].map(key=>[key.dataset.key,key.dataset.function||key.dataset.key]));
  const currentFingering=()=>id==='clarinet'?new Set([...pressed].map(key=>clarinetFunctions.get(key)||key)):pressed;
  if(id==='clarinet')controls.append(buildClarinetViewControls(art.querySelector('.clarinet-diagram')));
  if(id==='flute'){const embouchure=art.querySelector('.embouchure');embouchure.setAttribute('role','button');embouchure.setAttribute('tabindex','0');embouchure.setAttribute('aria-label','Switch to the upper flute octave');embouchure.setAttribute('aria-pressed','false');embouchure.addEventListener('click',()=>setFluteRegister(!highRegister));embouchure.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&!event.repeat){event.preventDefault();embouchure.click()}});}
  if(id==='clarinet'){
    const mouthpiece=art.querySelector('.clarinet-mouthpiece');let openVoice=null;
    mouthpiece.setAttribute('role','button');mouthpiece.setAttribute('tabindex','0');mouthpiece.setAttribute('aria-label','Hold the clarinet mouthpiece to play open written G4');mouthpiece.setAttribute('aria-pressed','false');
    const startOpen=event=>{if(heldDirectNoteKeys.size){clearDirectNoteState(true);stopInstrumentSounds('clarinet',true);updateWindDiagram(pressed)}if(pressed.size||openVoice)return;if(event){event.preventDefault();try{mouthpiece.setPointerCapture(event.pointerId)}catch{}}void ensureAudioReady();openVoice=playInstrumentNote('clarinet',midiForName('G4')-2,.24,'Open G4 · breath');mouthpiece.classList.add('mouthpiece-active');mouthpiece.setAttribute('aria-pressed','true');document.querySelector('#note-info').textContent=`Clarinet · Written G4 · concert ${pitchName(midiForName('G4')-2)} · open fingering`;if(practiceStatus&&practiceTarget==='G4'){practiceStatus.textContent='Correct · Written G4 · concert '+pitchName(midiForName('G4')-2);practiceStatus.classList.add('practice-success')}};
    const stopOpen=()=>{if(!openVoice)return;stopVoice(openVoice,false);openVoice=null;mouthpiece.classList.remove('mouthpiece-active');mouthpiece.setAttribute('aria-pressed','false')};stopOpenClarinet=stopOpen;
    mouthpiece.addEventListener('pointerdown',startOpen);mouthpiece.addEventListener('pointerup',stopOpen);mouthpiece.addEventListener('pointercancel',stopOpen);mouthpiece.addEventListener('lostpointercapture',stopOpen);mouthpiece.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.repeat){event.preventDefault();startOpen()}});mouthpiece.addEventListener('keyup',event=>{if(event.key==='Enter')stopOpen()});
  }  const heldInputs=new Map(),heldComputerKeys=new Map();
  const clearDirectNoteState=(immediate=true)=>{heldDirectNoteKeys.clear();registerLatched=false;if(keyboardNote.voice)stopVoice(keyboardNote.voice,immediate,.006);keyboardNote={code:null,label:null,chartLabel:null,voice:null}};
  const stopPendingWindNotes=()=>{for(const note of pendingNotes[id]||[])stopVoice(note,true);pendingNotes[id]=[]};
  const pressWindKey=(key,source)=>{if(id==='clarinet'){void ensureAudioReady();stopOpenClarinet();if(heldDirectNoteKeys.size){clearDirectNoteState(true);stopInstrumentSounds('clarinet',true);stopPendingWindNotes()}}const keyName=key.dataset.key,holders=heldInputs.get(keyName)||new Set();if(holders.has(source))return;holders.add(source);heldInputs.set(keyName,holders);if(pressed.has(keyName))return;pressed.add(keyName);updateWindDiagram(pressed);playRecognizedFingering()};
  const releaseWindKey=(key,source)=>{const keyName=key.dataset.key,holders=heldInputs.get(keyName);if(!holders?.has(source))return;holders.delete(source);if(holders.size)return;heldInputs.delete(keyName);pressed.delete(keyName);updateWindDiagram(pressed);if(pressed.size){playRecognizedFingering();return}stopInstrumentSounds(id,false,id==='clarinet'?.008:.11);stopPendingWindNotes();document.querySelector('#note-info').textContent=`${info[id].name} · Released · all keys open`};
  const resetClarinetInput=()=>{clearDirectNoteState(true);pressed.clear();heldInputs.clear();heldComputerKeys.clear();stopOpenClarinet();window.clearTimeout(clarinetRhythmFingeringTimer);clarinetRhythmFingeringTimer=0;selectedWrittenMidi=null;stopInstrumentSounds('clarinet',true);stopPendingWindNotes();updateWindDiagram(pressed)};
  clearWindControls=()=>{if(id==='flute')releaseFluteKeyboard();if(id==='clarinet')resetClarinetInput();else{pressed.clear();heldInputs.clear();heldComputerKeys.clear();updateWindDiagram(pressed);stopInstrumentSounds(id,true);stopPendingWindNotes()}};
  art.querySelectorAll('.wind-key[data-key]').forEach(key=>{
    key.setAttribute('role','button');key.setAttribute('tabindex','0');key.setAttribute('aria-pressed','false');key.setAttribute('aria-label',id==='clarinet'?`Press ${key.dataset.key} with ${key.dataset.finger||'the correct finger'}`:`Press flute key ${key.dataset.key}`);
    if(id==='clarinet'){
      key.addEventListener('pointerdown',event=>{event.preventDefault();pressWindKey(key,`pointer:${event.pointerId}`);try{key.setPointerCapture(event.pointerId)}catch{}});
      const releasePointer=event=>releaseWindKey(key,`pointer:${event.pointerId}`);
      key.addEventListener('pointerup',releasePointer);key.addEventListener('pointercancel',releasePointer);key.addEventListener('lostpointercapture',releasePointer);
      key.addEventListener('keydown',event=>{if(keyboardMode==='physical'&&event.key==='Enter'&&!event.repeat){event.preventDefault();pressWindKey(key,`keyboard:${event.key}`)}});
      key.addEventListener('keyup',event=>{if(keyboardMode==='physical'&&event.key==='Enter')releaseWindKey(key,`keyboard:${event.key}`)});
    }else{
      key.addEventListener('click',()=>{const keyName=key.dataset.key;if(pressed.has(keyName))pressed.delete(keyName);else pressed.add(keyName);updateWindDiagram(pressed);playRecognizedFingering()});
      key.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&!event.repeat){event.preventDefault();key.click()}});
    }
  });
  if(id==='clarinet'){
    const isTypingTarget=target=>target instanceof Element&&!!target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]');
    const clearPhysicalKeyboard=()=>{for(const [code,key] of heldComputerKeys){const keyName=key.dataset.key,holders=heldInputs.get(keyName);holders?.delete(`computer:${code}`);if(!holders?.size){heldInputs.delete(keyName);pressed.delete(keyName)}}heldComputerKeys.clear();updateWindDiagram(pressed)};
    const refreshNoteShortcut=()=>{
      const code=[...heldDirectNoteKeys].at(-1);
      if(!code){const oldVoice=keyboardNote.voice,startedAt=keyboardNote.startedAt||performance.now(),rhythmStateForNote=rhythmState?.instrument==='clarinet'?rhythmState:null,minAudibleDurationMs=rhythmStateForNote?Math.max(420,(rhythmStateForNote.stepBeats||.5)*60000/(rhythmStateForNote.bpm||120)*.9):220,releaseDelay=oldVoice?Math.max(0,minAudibleDurationMs-(performance.now()-startedAt)):0;keyboardNote={code:null,label:null,chartLabel:null,voice:null};if(oldVoice){if(releaseDelay)window.setTimeout(()=>stopVoice(oldVoice,false,.09),releaseDelay);else stopVoice(oldVoice,false,.008)}updateWindDiagram(pressed);if(pressed.size)playRecognizedFingering();else{if(!releaseDelay)stopInstrumentSounds('clarinet',false,.008);stopPendingWindNotes();document.querySelector('#note-info').textContent='Clarinet · Released'}return false}
      const baseLabel=clarinetNoteKeyboardMap[code];if(!baseLabel)return false;
      const naturalLabel=registerLatched?baseLabel.replace(/4$/,'5'):baseLabel;
      const adjustment=clarinetAccidental==='sharp'?1:clarinetAccidental==='flat'?-1:0,writtenMidi=midiForName(naturalLabel)+adjustment;
      const symbol=clarinetAccidental==='sharp'?'♯':clarinetAccidental==='flat'?'♭':'';
      const label=`${naturalLabel[0]}${symbol}${naturalLabel.slice(1)}`;
      const chartLabel=Object.keys(fingeringMap).find(candidate=>midiForName(candidate)===writtenMidi);if(!chartLabel){stopInstrumentSounds('clarinet',true);stopPendingWindNotes();keyboardNote={code,label,chartLabel:null,voice:null};document.querySelector('#note-info').textContent=`Clarinet · No chart fingering for ${label}`;return false}
      if(keyboardNote.code===code&&keyboardNote.label===label&&keyboardNote.voice&&!keyboardNote.voice.stopped)return true;
      if(keyboardNote.voice)stopVoice(keyboardNote.voice,true);
      stopInstrumentSounds('clarinet',true);stopPendingWindNotes();
      const concertMidi=writtenMidi-2;keyboardNote={code,label,chartLabel,voice:null,startedAt:performance.now()};selectedWrittenMidi=writtenMidi;
      updateWindDiagram(new Set(fingeringMap[chartLabel]||[]));keyboardNote.voice=playInstrumentNote('clarinet',concertMidi,.24,`Keyboard note · Written ${label}`);
      document.querySelector('#note-info').textContent=`Clarinet · Written ${label} · concert ${pitchName(concertMidi)} · keyboard note`;
      if(practiceStatus&&practiceTarget){const hit=midiForName(practiceTarget)===writtenMidi;practiceStatus.textContent=hit?`Correct · Written ${label} · concert ${pitchName(concertMidi)}`:`Detected ${label} · keep trying for ${practiceTarget}`;practiceStatus.classList.toggle('practice-success',hit)}
      return true;
    };
    startNoteShortcut=code=>{
      if(keyboardMode!=='notes'||!clarinetNoteKeyboardMap[code])return false;
      void ensureAudioReady();
      if(!heldDirectNoteKeys.size){stopOpenClarinet();clearPhysicalKeyboard();pressed.clear();heldInputs.clear();stopInstrumentSounds('clarinet',true);stopPendingWindNotes()}
      heldDirectNoteKeys.add(code);return refreshNoteShortcut();
    };
    const releaseNoteShortcut=code=>{if(!heldDirectNoteKeys.delete(code))return false;return refreshNoteShortcut()};
    const releaseRegisterModifier=()=>{if(!registerLatched)return;registerLatched=false;if(heldDirectNoteKeys.size)refreshNoteShortcut()};
    releaseClarinetKeyboard=()=>{resetClarinetInput()};
    clarinetKeyboardKeydown=event=>{
      if(player.classList.contains('hidden')||player.dataset.instrument!=='clarinet'||isTypingTarget(event.target)||event.ctrlKey||event.altKey||event.metaKey)return;
      if(event.code==='Space'&&!document.querySelector('#song-picker').classList.contains('hidden'))return;
      if(event.code==='Space'){event.preventDefault();if(!event.repeat){if(rhythmState?.instrument==='clarinet')toggleRhythmPause();else{stopPlayback();document.querySelector('#sound-caption').textContent='Playback stopped'}}return}
      if(event.code==='BracketLeft'||event.code==='BracketRight'){event.preventDefault();if(!event.repeat)setAccidental(event.code==='BracketRight'?'sharp':'flat');return}
      if(keyboardMode==='notes'){
        if(event.code==='KeyW'){event.preventDefault();if(!registerLatched){registerLatched=true;if(heldDirectNoteKeys.size)refreshNoteShortcut()}return}
        if(clarinetNoteKeyboardMap[event.code]){event.preventDefault();if(!event.repeat)startNoteShortcut(event.code);return}
        return;
      }
      const modelKey=clarinetKeyboardMap[event.code];if(!modelKey)return;event.preventDefault();if(event.repeat||heldComputerKeys.has(event.code))return;
      const key=art.querySelector(`.clarinet-key[data-key="${modelKey}"]`);if(!key)return;heldComputerKeys.set(event.code,key);pressWindKey(key,`computer:${event.code}`);
    };
    clarinetKeyboardKeyup=event=>{if(player.dataset.instrument!=='clarinet')return;if(event.code==='Space'){event.preventDefault();return}if(heldDirectNoteKeys.has(event.code)){event.preventDefault();releaseNoteShortcut(event.code);return}if(event.code==='KeyW'&&registerLatched&&keyboardMode==='notes'){event.preventDefault();releaseRegisterModifier();return}const key=heldComputerKeys.get(event.code);if(!key)return;event.preventDefault();heldComputerKeys.delete(event.code);releaseWindKey(key,`computer:${event.code}`)};
  }  let clarinetRhythmFingeringTimer=0;
  function playRecognizedFingering(){
    const evaluate=()=>{
      const soundingKeys=currentFingering(),matches=notes[id].filter(([label])=>fingeringMap[label]&&sameKeySet(soundingKeys,new Set(fingeringMap[label])));
      if(!matches.length){stopInstrumentSounds(id);for(const note of pendingNotes[id]||[])stopVoice(note,true);pendingNotes[id]=[];document.querySelector('#note-info').textContent=`${info[id].name} · ${pressed.size?'No mapped fingering':'All keys open'}`;return}
      const registerMatches=id==='flute'?matches.filter(candidate=>highRegister?candidate[1]>=84:candidate[1]<84):matches,candidates=registerMatches.length?registerMatches:matches,preferred=selectedWrittenMidi??(id==='flute'?(highRegister?84:72):60),chosen=candidates.reduce((best,candidate)=>Math.abs(candidate[1]-preferred)<Math.abs(best[1]-preferred)?candidate:best,candidates[0]);
      selectedWrittenMidi=chosen[1];const soundingMidi=id==='clarinet'?chosen[1]-2:chosen[1],label=id==='clarinet'?`Written ${chosen[0]} · concert ${pitchName(soundingMidi)}`:chosen[0];if(practiceStatus&&practiceTarget){const hit=chosen[0]===practiceTarget;practiceStatus.textContent=hit?`Correct · ${label}`:`Detected ${label} · keep trying for ${practiceTarget}`;practiceStatus.classList.toggle('practice-success',hit)}
      playInstrumentNote(id,soundingMidi,.24,`Fingering · ${[...pressed].join(', ')||'open'}`);document.querySelector('#note-info').textContent=`${info[id].name} · ${label} · ${[...pressed].join(', ')||'open'}`;
    };
    if(id==='clarinet'&&rhythmState?.instrument==='clarinet'){window.clearTimeout(clarinetRhythmFingeringTimer);clarinetRhythmFingeringTimer=window.setTimeout(evaluate,14);return}
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

    const keyboardGuide=document.createElement('details');keyboardGuide.className='clarinet-keyboard-guide';keyboardGuide.open=false;const keyboardSummary=document.createElement('summary');keyboardSummary.textContent='Computer keyboard guide';keyboardGuide.append(keyboardSummary);
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
    practiceStatus=document.createElement('span');practiceStatus.className='clarinet-practice-status';practiceStatus.setAttribute('aria-live','polite');practiceStatus.textContent='Practice natural notes C–B; hold the matching keys together.';practiceHead.append(practiceTitle,practiceStatus);
    const practiceActions=document.createElement('div');practiceActions.className='clarinet-practice-actions';
    const guideButton=makeButton('Finger guide: on','clarinet-practice-button');guideButton.setAttribute('aria-pressed','true');
    const setTarget=label=>{practiceTarget=label;practiceStatus.textContent=`Play written ${label} · concert ${pitchName(midiForName(label)-2)}`;practiceStatus.classList.remove('practice-success');art.querySelectorAll('.clarinet-key').forEach(key=>key.classList.toggle('guide-key',fingerGuide&&(fingeringMap[label]||[]).includes(key.dataset.function||key.dataset.key)))};
    guideButton.addEventListener('click',()=>{fingerGuide=!fingerGuide;guideButton.textContent=`Finger guide: ${fingerGuide?'on':'off'}`;guideButton.setAttribute('aria-pressed',String(fingerGuide));art.querySelectorAll('.clarinet-key').forEach(key=>key.classList.toggle('guide-key',fingerGuide&&practiceTarget&&(fingeringMap[practiceTarget]||[]).includes(key.dataset.function||key.dataset.key)))});
    const newPractice=highOnly=>{const choices=notes.clarinet.filter(([label,midi])=>fingeringMap[label]&&/^[A-G]\d+$/.test(label)&&(!highOnly||midi>=83));if(!choices.length)return;const choice=choices[Math.floor(Math.random()*choices.length)];setTarget(choice[0])};
    const practiceButton=makeButton('Practice a note','clarinet-practice-button');practiceButton.addEventListener('click',()=>newPractice(false));
    const highButton=makeButton('High-note practice','clarinet-practice-button');highButton.addEventListener('click',()=>newPractice(true));
    practiceActions.append(practiceButton,highButton,guideButton);
    const accidentalControls=document.createElement('div');accidentalControls.className='clarinet-accidental-controls';accidentalControls.setAttribute('aria-label','Note accidental controls');
    const accidentalLabel=document.createElement('span');accidentalLabel.className='clarinet-accidental-label';accidentalLabel.textContent='Note modifier';
    const sharpButton=makeButton('♯ Sharp','clarinet-accidental-button');sharpButton.setAttribute('aria-label','Toggle sharp notes');sharpButton.setAttribute('aria-pressed','false');
    const flatButton=makeButton('♭ Flat','clarinet-accidental-button');flatButton.setAttribute('aria-label','Toggle flat notes');flatButton.setAttribute('aria-pressed','false');
    setAccidental=mode=>{clarinetAccidental=clarinetAccidental===mode?'natural':mode;sharpButton.classList.toggle('active',clarinetAccidental==='sharp');flatButton.classList.toggle('active',clarinetAccidental==='flat');sharpButton.setAttribute('aria-pressed',String(clarinetAccidental==='sharp'));flatButton.setAttribute('aria-pressed',String(clarinetAccidental==='flat'));if(keyboardNote.code)startNoteShortcut(keyboardNote.code);else document.querySelector('#note-info').textContent=`Clarinet · ${clarinetAccidental==='natural'?'Natural notes':`${clarinetAccidental==='sharp'?'Sharp':'Flat'} mode selected`}`};
    sharpButton.addEventListener('click',()=>setAccidental('sharp'));flatButton.addEventListener('click',()=>setAccidental('flat'));accidentalControls.append(accidentalLabel,sharpButton,flatButton);
    const keyboardModeControls=document.createElement('div');keyboardModeControls.className='clarinet-keyboard-modes';keyboardModeControls.setAttribute('role','group');keyboardModeControls.setAttribute('aria-label','Choose clarinet computer keyboard input mode');
    const keyboardModeLabel=document.createElement('span');keyboardModeLabel.className='clarinet-accidental-label';keyboardModeLabel.textContent='Computer keyboard mode';
    const noteModeButton=makeButton('Easy notes · C–B','clarinet-practice-button');noteModeButton.setAttribute('aria-pressed','false');
    const fingeringModeButton=makeButton('Advanced fingering keys','clarinet-practice-button');fingeringModeButton.setAttribute('aria-pressed','false');
    const keyboardModeStatus=document.createElement('span');keyboardModeStatus.className='clarinet-keyboard-mode-status';keyboardModeStatus.setAttribute('aria-live','polite');
    const keyboardGuide=document.createElement('details');keyboardGuide.className='clarinet-keyboard-guide';keyboardGuide.open=false;const keyboardSummary=document.createElement('summary');const keyboardList=document.createElement('div');keyboardList.className='clarinet-keyboard-list';keyboardGuide.append(keyboardSummary,keyboardList);
    const appendKeyboardRow=(keyText,descriptionText)=>{const row=document.createElement('div');row.className='clarinet-keyboard-row';const cap=document.createElement('kbd');cap.textContent=keyText;const description=document.createElement('span');description.textContent=descriptionText;row.append(cap,description);keyboardList.append(row)};
    const updateKeyboardGuide=()=>{
      const direct=keyboardMode==='notes';keyboardList.replaceChildren();keyboardSummary.textContent=direct?'Keyboard guide · Direct note shortcuts':'Keyboard guide · Physical clarinet keys';
      if(direct){Object.entries(clarinetNoteKeyboardMap).forEach(([code,label])=>appendKeyboardRow(code.replace(/^Key/,''),`Written ${label} → concert ${pitchName(midiForName(label)-2)}`));appendKeyboardRow('W','Hold for the next octave; release to return.');appendKeyboardRow('[','Toggle flat; press again for natural.');appendKeyboardRow(']','Toggle sharp; press again for natural.')}
      else{Object.entries(clarinetKeyboardMap).forEach(([code,modelKey])=>{const key=art.querySelector(`.clarinet-key[data-key="${modelKey}"]`);if(key)appendKeyboardRow(code.replace(/^Key/,''),`${modelKey} · ${key.dataset.finger||'Clarinet key'}`)});appendKeyboardRow('Enter','Press/release the focused virtual key.')}
      appendKeyboardRow('Space','Stop all active sound.');
    };
    const updateKeyboardMode=()=>{const direct=keyboardMode==='notes';noteModeButton.setAttribute('aria-pressed',String(direct));fingeringModeButton.setAttribute('aria-pressed',String(!direct));art.classList.toggle('clarinet-direct-note-mode',direct);keyboardModeStatus.textContent=direct?'C–B plays written C4–B4; hold W for the higher octave. Physical keys such as Q are inactive in this mode.':'Q controls the left index ring. Hold the listed physical keys together; their combination selects the fingering.';updateKeyboardGuide()};
    const selectKeyboardMode=mode=>{if(keyboardMode===mode)return;resetClarinetInput();keyboardMode=mode;currentClarinetKeyboardMode=mode;playerProgress.settings.clarinetControlMode=mode;savePlayerProgress();updateKeyboardMode();document.querySelector('#note-info').textContent=mode==='notes'?'Clarinet · Easy note keyboard selected':'Clarinet · Advanced fingering keyboard selected'};
    noteModeButton.addEventListener('click',()=>selectKeyboardMode('notes'));fingeringModeButton.addEventListener('click',()=>selectKeyboardMode('physical'));keyboardModeControls.append(keyboardModeLabel,noteModeButton,fingeringModeButton,keyboardModeStatus);updateKeyboardMode();
    const chart=document.createElement('details');chart.className='clarinet-chart';const summary=document.createElement('summary');summary.textContent='Full chromatic fingering chart · advanced';chart.append(summary);
    const chartList=document.createElement('div');chartList.className='clarinet-chart-list';
    notes.clarinet.filter(([label])=>fingeringMap[label]).forEach(([label,midi])=>{const row=makeButton('','clarinet-chart-note');row.setAttribute('aria-label',`Show fingering for written ${label}, concert ${pitchName(midi-2)}`);const noteName=document.createElement('strong');noteName.textContent=label;const concertName=document.createElement('span');concertName.textContent=`Concert ${pitchName(midi-2)}`;const keyNames=document.createElement('small');keyNames.textContent=(fingeringMap[label].length?fingeringMap[label].join(' + '):'Open fingering · hold mouthpiece');row.append(noteName,concertName,keyNames);row.addEventListener('click',()=>setTarget(label));chartList.append(row)});
    const sourceNote=document.createElement('p');sourceNote.className='clarinet-chart-source';sourceNote.textContent='Boehm B♭ soprano clarinet · written E3–G6 · transposing pitch is written note down a major second. Core fingerings follow the Woodwind Fingering Guide.';chart.append(chartList,sourceNote);practice.append(practiceHead,practiceActions,accidentalControls,keyboardModeControls,keyboardGuide,chart);controls.append(practice);
  }  const tip=document.createElement('p');tip.className='key-hint';tip.textContent=id==='clarinet'?'Use the open keyboard guide for the active mode. Easy note keys C-B are selected by default. Use the keyboard guide or choose Advanced fingering keys for combinations.':id==='flute'?'Use C-B for flute notes. Press W or the embouchure to switch octaves; [ and ] toggle flat and sharp.':'Tap the instrument keys to cover or uncover them; a matching fingering plays its note.';controls.append(tip);
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
    const bow=makeButton('Hold bow to play selected note(s)','bow-control');bow.disabled=true;const hint=document.createElement('p');hint.className='key-hint';hint.textContent='Touch anywhere along a lower string to play that position. Hold two string rows together for a double stop, or select both notes and hold the bow.';wirePlay(bow,()=>[...selectedViolinNotes.values()].map(note=>playInstrumentNote('violin',note.midi,.24,`${note.label} string · ${note.place} · bow`)),{release:true});
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
    svg.querySelectorAll('.violin-model-string').forEach(group=>wirePlay(group,event=>playModelString(group,event),{release:true,minHoldMs:420}));setHandPosition(0);
    const keyboardStrings=new Set(),keyboardFingers=new Map(),keyboardVoices=new Map(),stringCodes=Object.fromEntries(Object.entries(violinKeyboardMap).map(([code,index])=>[code,index])),easyNotes=violinEasyKeyboardMap;let violinKeyboardMode=currentViolinKeyboardMode;
    const advancedStringTags=Object.entries(violinKeyboardMap).map(([code,index])=>{const name=neck.querySelector(`.violin-string-row[data-string-index="${index}"] .neck-string-name`),tag=addComputerKeyLabel(name,code.replace(/^Key/,''));tag.classList.add('advanced-key-label');tag.hidden=true;return tag});
    const easyFingerTags=Object.entries(easyNotes).map(([code,[stringIndex,finger]])=>{const button=buttonRows.find(item=>Number(item.dataset.stringIndex)===stringIndex&&Number(item.dataset.finger)===finger),tag=addComputerKeyLabel(button,code.replace(/^Key/,''));tag.classList.add('easy-key-label');return tag});
    const currentKeyboardFinger=()=>{const active=[...keyboardFingers.values()];return active.length?active[active.length-1]:0};
    const syncKeyboardStrings=()=>{for(const stringIndex of keyboardStrings){const finger=currentKeyboardFinger(),old=keyboardVoices.get(stringIndex);if(old?.finger===finger)continue;if(old){stopVoice(old.voice,false,.025);old.button.classList.remove('keyboard-held','playing')};const button=buttonRows.find(item=>Number(item.dataset.stringIndex)===stringIndex&&Number(item.dataset.finger)===finger),string=neck.querySelector(`.violin-string-row[data-string-index="${stringIndex}"]`);if(!button||!string)continue;button.classList.add('keyboard-held');const voice=playViolinFinger(stringIndex,finger,button,string);keyboardVoices.set(stringIndex,{finger,button,voice,advanced:true})}};
    const releaseKeyboardString=stringIndex=>{const old=keyboardVoices.get(stringIndex);if(old){stopVoice(old.voice,false,.045);old.button.classList.remove('keyboard-held','playing');keyboardVoices.delete(stringIndex)}selectedViolinNotes.delete(stringIndex);markers[stringIndex].setAttribute('visibility','hidden');bow.disabled=selectedViolinNotes.size===0;updateViolinReadout()};
    const playEasyViolinNote=code=>{const [stringIndex,finger]=easyNotes[code],old=keyboardVoices.get(stringIndex);if(old)releaseKeyboardString(stringIndex);const button=buttonRows.find(item=>Number(item.dataset.stringIndex)===stringIndex&&Number(item.dataset.finger)===finger),string=neck.querySelector(`.violin-string-row[data-string-index="${stringIndex}"]`);if(!button||!string)return;button.classList.add('keyboard-held');const voice=playViolinFinger(stringIndex,finger,button,string);keyboardVoices.set(stringIndex,{finger,button,voice,code})};
    violinKeyboardKeydown=event=>{if(player.classList.contains('hidden')||player.dataset.instrument!=='violin'||isTypingTarget(event.target)||event.ctrlKey||event.altKey||event.metaKey||event.repeat)return;if(violinKeyboardMode==='easy'){if(!easyNotes[event.code]||[...keyboardVoices.values()].some(note=>note.code===event.code))return;event.preventDefault();void ensureAudioReady();playEasyViolinNote(event.code);return}const index=stringCodes[event.code],finger=violinFingerKeyboardMap[event.code];if(index===undefined&&finger===undefined)return;event.preventDefault();void ensureAudioReady();if(index!==undefined){if(keyboardStrings.has(index))return;keyboardStrings.add(index);syncKeyboardStrings()}else{keyboardFingers.set(event.code,finger);syncKeyboardStrings()}};
    violinKeyboardKeyup=event=>{if(player.dataset.instrument!=='violin')return;if(violinKeyboardMode==='easy'){const entry=[...keyboardVoices.entries()].find(([,note])=>note.code===event.code);if(entry){event.preventDefault();releaseKeyboardString(entry[0])}return}const index=stringCodes[event.code];if(index!==undefined&&keyboardStrings.delete(index)){event.preventDefault();releaseKeyboardString(index);return}if(keyboardFingers.delete(event.code)){event.preventDefault();syncKeyboardStrings()}};
    clearInstrumentKeyboard=()=>{for(const [index,note] of keyboardVoices){stopVoice(note.voice,true);note.button.classList.remove('keyboard-held','playing');selectedViolinNotes.delete(index);markers[index].setAttribute('visibility','hidden')}keyboardStrings.clear();keyboardFingers.clear();keyboardVoices.clear();bow.disabled=selectedViolinNotes.size===0;updateViolinReadout()};
    const guide=buildKeyboardGuide([]),guideList=guide.querySelector('.clarinet-keyboard-list'),modeButton=makeButton('Use advanced fingering keys','clarinet-practice-button');modeButton.setAttribute('aria-pressed','false');
    const updateViolinMode=()=>{modeButton.textContent=violinKeyboardMode==='easy'?'Use advanced fingering keys':'Use easy note keys C–B';modeButton.setAttribute('aria-pressed',String(violinKeyboardMode==='advanced'));advancedStringTags.forEach(tag=>tag.hidden=violinKeyboardMode!=='advanced');easyFingerTags.forEach(tag=>tag.hidden=violinKeyboardMode!=='easy');guideList.replaceChildren();const entries=violinKeyboardMode==='easy'?Object.entries(easyNotes).map(([code,[index,finger,note]])=>[code.replace(/^Key/,''),`${note} · ${notes.violin[index][0]} string, finger ${finger}`]).concat([['Space','Stop active sounds.']]):[['Q','G3 string'],['W','D4 string'],['E','A4 string'],['R','E5 string'],['1–4','Finger positions 1–4; hold with a string key.'],['0','Open string; release finger keys.'],['Space','Stop active sounds.']];entries.forEach(([keyName,description])=>{const row=document.createElement('div');row.className='clarinet-keyboard-row';const key=document.createElement('kbd'),textNode=document.createElement('span');key.textContent=keyName;textNode.textContent=description;row.append(key,textNode);guideList.append(row)});guide.querySelector('summary').textContent=violinKeyboardMode==='easy'?'Easy keyboard · natural notes':'Advanced keyboard · string and finger controls'};
    modeButton.addEventListener('click',()=>{clearInstrumentKeyboard();violinKeyboardMode=violinKeyboardMode==='easy'?'advanced':'easy';currentViolinKeyboardMode=violinKeyboardMode;playerProgress.settings.violinControlMode=violinKeyboardMode;savePlayerProgress();if(violinKeyboardMode==='easy')setHandPosition(0);updateViolinMode()});updateViolinMode();
    controls.append(modeButton,bow,hint,guide);return;
  }
  art.innerHTML=renderGuitarSvg();
  const board=document.createElement('div');board.className='string-board instrument-neck guitar-neck';
  const header=document.createElement('div');header.className='neck-labels';header.innerHTML='<span>LOW E · E2</span><span>TAP A STRING AT A FRET · OPEN OR 1–24</span><span>HIGH E · E4</span>';board.append(header);
  const neck=document.createElement('div');neck.className='neck guitar-fingerboard';
  const fretEdge=n=>1-2**(-n/12),fretCenter=fret=>fret===0?3:6+94*(fretEdge(fret-1)+fretEdge(fret))/2;
  const inlays=document.createElement('div');inlays.className='fret-inlays';[3,5,7,9,12,15,17,19,21,24].forEach(fret=>{const dot=document.createElement('i');dot.className=fret===12||fret===24?'double-inlay':'';dot.style.left=`${fretCenter(fret)}%`;inlays.append(dot)});neck.append(inlays);
  notes.guitar.forEach(([label,base],stringIndex)=>{
    const baseMidi=Math.round(69+12*Math.log2(base/440)),string=document.createElement('div');string.className='neck-string guitar-fret-string';string.dataset.stringIndex=String(stringIndex);string.style.top=`${100*stringIndex/notes.guitar.length}%`;string.style.height=`${100/notes.guitar.length}%`;string.setAttribute('role','button');string.tabIndex=0;
    const name=document.createElement('span');name.className='neck-string-name';name.textContent=label;string.append(name);addComputerKeyLabel(name,String(stringIndex+1));
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
  const naturalNoteLabels=new Map();Object.entries(guitarNoteKeyboardMap).forEach(([code,note])=>{const badge=document.createElement('span');badge.className='guitar-note-key-label';badge.textContent=code.slice(3);badge.title=`${note.label} · B string · fret ${note.fret}`;badge.style.left=`${fretCenter(note.fret)}%`;badge.style.top=`${100*(note.stringIndex+.5)/notes.guitar.length}%`;naturalNoteLabels.set(code,badge);neck.append(badge)});
  const frets=document.createElement('div');frets.className='fret-wires';for(let fret=1;fret<=24;fret++){const wire=document.createElement('i');wire.style.left=`${6+94*fretEdge(fret)}%`;frets.append(wire)}neck.append(frets);board.append(neck);controls.appendChild(board);
  art.querySelectorAll('[data-guitar-string]').forEach(line=>{const strum=()=>{const index=Number(line.dataset.guitarString),fret=selectedGuitarFrets.get(index)||0,entry=notes.guitar[index],base=Math.round(69+12*Math.log2(entry[1]/440)),midi=base+fret;line.classList.add('strummed');window.setTimeout(()=>line.classList.remove('strummed'),180);playInstrumentNote('guitar',midi,.24,`${entry[0]} string · fret ${fret}`)};line.addEventListener('click',strum);line.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&!event.repeat){event.preventDefault();strum()}})});
  const heldGuitarKeys=new Map();
  guitarKeyboardKeydown=event=>{if(player.classList.contains('hidden')||player.dataset.instrument!=='guitar'||isTypingTarget(event.target)||event.ctrlKey||event.altKey||event.metaKey||event.repeat||heldGuitarKeys.has(event.code))return;const note=guitarNoteKeyboardMap[event.code],index=note?.stringIndex??guitarKeyboardMap[event.code];if(index===undefined)return;event.preventDefault();void ensureAudioReady();const line=art.querySelector(`.guitar-svg-string[data-guitar-string="${index}"]`);if(!line)return;if(note){const voice=playInstrumentNote('guitar',note.midi,.24,`${note.label} · B string fret ${note.fret}`),noteLabel=naturalNoteLabels.get(event.code);heldGuitarKeys.set(event.code,{line,voice,noteLabel});noteLabel?.classList.add('active')}else{const fret=selectedGuitarFrets.get(index)||0,[label,base]=notes.guitar[index],midi=Math.round(69+12*Math.log2(base/440))+fret,voice=playInstrumentNote('guitar',midi,.24,`${label} string · fret ${fret} · keyboard`);heldGuitarKeys.set(event.code,{line,voice})}line.classList.add('strummed','keyboard-held')};
  guitarKeyboardKeyup=event=>{if(player.dataset.instrument!=='guitar')return;const held=heldGuitarKeys.get(event.code);if(!held)return;event.preventDefault();held.noteLabel?.classList.remove('active');heldGuitarKeys.delete(event.code);if(![...heldGuitarKeys.values()].some(item=>item.line===held.line))held.line.classList.remove('strummed','keyboard-held')};
  clearInstrumentKeyboard=()=>{heldGuitarKeys.forEach(({line,noteLabel})=>{line.classList.remove('strummed','keyboard-held');noteLabel?.classList.remove('active')});heldGuitarKeys.clear()};
  const guitarGuide=buildKeyboardGuide([...Object.entries(guitarNoteKeyboardMap).map(([code,note])=>[code.replace(/^Key/,''),`${note.label} · B string fret ${note.fret}`]),...Object.entries(guitarKeyboardMap).map(([code,index])=>[code.replace(/^Digit/,''),`${notes.guitar[index][0]} string · plays the selected fret`]),['Tap fretboard','Select a fret; a numbered string key uses that position.'],['Space','Stop active sounds.']]);controls.append(guitarGuide);
}
function buildDrums(){const kit=document.createElement('div');kit.className='drum-kit';const pads=[['Closed hi-hat','hat','hi-hat','A'],['Open hi-hat','hatOpen','open-hat','L'],['Crash','crash','crash','J'],['High tom','tomHigh','tomHigh','F'],['Mid tom','tomMid','tomMid','G'],['Ride','ride','ride','K'],['Snare','snare','snare','S'],['Snare snap','snareSnap','snare-snap',';'],['Floor tom','tomLow','tomLow','H'],['Bass drum','bass','bass','D']],heldDrumKeys=new Map();pads.forEach(([label,part,style,key])=>{const b=makeButton(label,`drum ${style}`);b.dataset.drumPart=part;addComputerKeyLabel(b,key);wirePlay(b,()=>hitDrum(part));kit.appendChild(b)});controls.appendChild(kit);
  drumKeyboardKeydown=event=>{if(player.classList.contains('hidden')||player.dataset.instrument!=='drums'||isTypingTarget(event.target)||event.ctrlKey||event.altKey||event.metaKey||event.repeat||heldDrumKeys.has(event.code))return;const part=drumKeyboardMap[event.code];if(!part)return;event.preventDefault();void ensureAudioReady();const button=kit.querySelector(`[data-drum-part="${part}"]`);hitDrum(part);if(button){heldDrumKeys.set(event.code,button);button.classList.add('playing','keyboard-hit')}};
  drumKeyboardKeyup=event=>{if(player.dataset.instrument!=='drums')return;const button=heldDrumKeys.get(event.code);if(!button)return;event.preventDefault();heldDrumKeys.delete(event.code);button.classList.remove('playing','keyboard-hit')};
  clearInstrumentKeyboard=()=>{heldDrumKeys.forEach(button=>button.classList.remove('playing','keyboard-hit'));heldDrumKeys.clear()};
  controls.append(buildKeyboardGuide([...Object.entries(drumKeyboardMap).map(([code,part])=>[code==='Semicolon'?';':code.replace(/^Key/,''),pads.find(([,key])=>key===part)?.[0]||part]),['Space','Stop active sounds.']]));
}
document.querySelectorAll('[data-instrument]').forEach(card=>card.addEventListener('click',()=>choose(card.dataset.instrument)));
document.querySelector('#back-button').addEventListener('click',()=>leaveInstrument());
document.querySelector('#stop-sound').addEventListener('click',()=>{stopPlayback();stopRhythmGame('Stopped');document.querySelector('#sound-caption').textContent='Playback stopped';});
document.querySelector('#volume-slider').addEventListener('input',event=>{if(master)master.gain.setTargetAtTime(Number(event.target.value)/100,audio.currentTime,.025)});
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(rhythmState)setRhythmPaused(true);else stopPlayback()}});
window.addEventListener('pagehide',()=>{stopRhythmGame('Stopped');stopPlayback()});
document.addEventListener('keydown',rememberMappedKeyDown,true);
document.addEventListener('keyup',forgetMappedKeyUp,true);
document.addEventListener('keydown',playFromComputerKey);
document.addEventListener('keydown',event=>clarinetKeyboardKeydown(event));
document.addEventListener('keyup',event=>clarinetKeyboardKeyup(event));
document.addEventListener('keydown',event=>fluteKeyboardKeydown(event));
document.addEventListener('keyup',event=>fluteKeyboardKeyup(event));
document.addEventListener('keydown',event=>guitarKeyboardKeydown(event));
document.addEventListener('keyup',event=>guitarKeyboardKeyup(event));
document.addEventListener('keydown',event=>drumKeyboardKeydown(event));
document.addEventListener('keyup',event=>drumKeyboardKeyup(event));
document.addEventListener('keydown',event=>violinKeyboardKeydown(event));
document.addEventListener('keyup',event=>violinKeyboardKeyup(event));
document.addEventListener('keyup',releasePianoComputerKey);
document.addEventListener('keydown',stopActiveSoundsKey);
window.addEventListener('blur',()=>{if(player.dataset.instrument==='clarinet'||player.dataset.instrument==='flute')clearWindControls();releaseClarinetKeyboard();releaseFluteKeyboard();if(rhythmState)setRhythmPaused(true);for(const control of [...activeControls])releaseControl(control);for(const voice of heldPianoKeys.values())if(voice)stopVoice(voice);heldPianoKeys.clear();clearInstrumentKeyboard();clearKeyboardFeedback()});

// Original rhythm-game patterns. Notes are fixed lane numbers, never randomized.
const rhythmPicker=document.querySelector('#song-picker'),rhythmPanel=document.querySelector('#rhythm-game');
let selectedSong=null,rhythmState=null,rhythmRaf=0,rhythmStartToken=0;
const rhythmPitchLanes={
  piano:[60,62,64,65,67,69,71],guitar:[60,62,64,65,67,69,71],
  violin:[55,57,59,60,62,64,67],
  flute:[72,74,76,77,79,81,83],clarinet:[58,60,62,63,65,67,69]
};
// Original five practice songs. Each array entry is one fixed eighth-note slot;
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
  ['first-note','First Note','Play your first instrument note.'],['first-song','First Song','Finish a song.'],['perfect-start','Perfect Start','Earn 10 Perfect hits.'],['combo-master','Combo Master','Reach a 20-note combo.'],['music-beginner','Music Beginner','Complete 3 different levels.'],['rising-musician','Rising Musician','Complete 5 different levels.'],['music-expert','Music Expert','Complete all 10 levels.'],['three-star-player','Three-Star Player','Earn three stars on a song.'],['instrument-explorer','Instrument Explorer','Play 5 different instruments.'],['clarinet-master','Clarinet Master','Finish 5 songs on clarinet.'],['daily-streak','Daily Performer','Complete a daily challenge.']
].map(([id,name,description])=>({id,name,description}));
const progressStorageKey='instrument-testing-progress-v1';
const progressDefaults=()=>({unlockedLevels:[1],completedLevels:[],bestScores:{},songStars:{},achievements:{},dailyChallenge:{date:'',instrument:'piano',goal:10,progress:0,completed:false},stats:{totalPerfectHits:0,highestCombo:0,songsCompleted:0,clarinetSongs:0,challengePoints:0,instrumentsUsed:[]},settings:{practiceMode:false,practiceTempo:100,metronomeEnabled:false,advancedMode:false,volume:35,rhythmDifficulty:'easy',lastInstrument:'',tutorialSeen:false,clarinetControlMode:'notes',violinControlMode:'easy'}});
function loadPlayerProgress(){
  const defaults=progressDefaults();try{const saved=JSON.parse(localStorage.getItem(progressStorageKey)||'null');if(!saved||typeof saved!=='object')return defaults;const settings={...defaults.settings,...saved.settings};if(!Number.isFinite(Number(saved.settings?.practiceTempo)))settings.practiceTempo=saved.settings?.practiceMode?75:100;return {...defaults,...saved,stats:{...defaults.stats,...saved.stats,instrumentsUsed:Array.isArray(saved.stats?.instrumentsUsed)?saved.stats.instrumentsUsed:[]},settings,dailyChallenge:saved.dailyChallenge&&typeof saved.dailyChallenge==='object'?{...defaults.dailyChallenge,...saved.dailyChallenge}:defaults.dailyChallenge,unlockedLevels:Array.isArray(saved.unlockedLevels)&&saved.unlockedLevels.length?saved.unlockedLevels:[1],completedLevels:Array.isArray(saved.completedLevels)?saved.completedLevels:[],bestScores:saved.bestScores&&typeof saved.bestScores==='object'?saved.bestScores:{},songStars:saved.songStars&&typeof saved.songStars==='object'?saved.songStars:{},achievements:saved.achievements&&typeof saved.achievements==='object'?saved.achievements:{}}}catch{return defaults}
}
const playerProgress=loadPlayerProgress();
let appFlow='free',selectedLevelNumber=null,achievementToastTimer=0,selectedRhythmSongId=null;
function savePlayerProgress(){try{localStorage.setItem(progressStorageKey,JSON.stringify(playerProgress))}catch(error){console.warn('Progress could not be saved in this browser',error)}}
function unlockAchievement(id){
  if(playerProgress.achievements[id])return;const achievement=achievementCatalog.find(item=>item.id===id);if(!achievement)return;playerProgress.achievements[id]=Date.now();savePlayerProgress();renderAchievements();const toast=document.querySelector('#achievement-toast');toast.textContent=`Achievement unlocked · ${achievement.name}`;toast.classList.remove('hidden');window.clearTimeout(achievementToastTimer);achievementToastTimer=window.setTimeout(()=>toast.classList.add('hidden'),3200);
}
function recordPlayerAction(instrument){
  if(!playerProgress.stats.instrumentsUsed.includes(instrument))playerProgress.stats.instrumentsUsed.push(instrument);if(!playerProgress.settings.tutorialSeen){playerProgress.settings.tutorialSeen=true;document.querySelector('#first-play-tutorial')?.classList.add('hidden')}updateDailyChallengeProgress(instrument);savePlayerProgress();unlockAchievement('first-note');if(playerProgress.stats.instrumentsUsed.length>=5)unlockAchievement('instrument-explorer');
}
function rhythmSongTotalBeats(song){return song?.sheetNotes?Math.max(0,...song.sheetNotes.map(note=>note.beat+(note.durationBeats||0))):song.pattern.length*song.step}
function niceLength(song){const seconds=Math.round(rhythmSongTotalBeats(song)*60/song.bpm);return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`}
function renderAchievements(){
  const list=document.querySelector('#achievements-list');if(!list)return;list.replaceChildren();achievementCatalog.forEach(item=>{const unlocked=!!playerProgress.achievements[item.id],card=document.createElement('article');card.className=`achievement-card${unlocked?' unlocked':''}`;const mark=document.createElement('span');mark.className='achievement-mark';mark.textContent=unlocked?'♪':'○';const copy=document.createElement('div'),title=document.createElement('strong'),description=document.createElement('p');title.textContent=item.name;description.textContent=item.description;copy.append(title,description);const state=document.createElement('small');state.textContent=unlocked?'Unlocked':'Locked';card.append(mark,copy,state);list.append(card)})
}
function renderLevels(){
  const list=document.querySelector('#levels-list'),summary=document.querySelector('#level-summary');if(!list)return;list.replaceChildren();const unlocked=new Set(playerProgress.unlockedLevels);summary.textContent=`${playerProgress.completedLevels.length}/10 completed`;
  levelCatalog.forEach((level,index)=>{const number=index+1,available=unlocked.has(number),done=playerProgress.completedLevels.includes(number),button=document.createElement('button');button.type='button';button.className=`level-card${available?'':' locked'}${done?' completed':''}`;button.disabled=!available;const badge=document.createElement('span');badge.className='level-number';badge.textContent=String(number).padStart(2,'0');const body=document.createElement('span');body.className='level-copy';const name=document.createElement('strong'),detail=document.createElement('small'),best=document.createElement('small');const song=musicLibrary.find(item=>item.id===level.song);name.textContent=`Level ${number} · ${song?.name||'Practice'}`;detail.textContent=`${level.bpm} BPM · ${level.difficulty} · Target ${level.target.toLocaleString()} points`;best.textContent=done?`Completed · best ${Number(playerProgress.bestScores[`level-${number}`]||0).toLocaleString()}`:available?'Ready to play':'Unlock the previous level';body.append(name,detail,best);const status=document.createElement('span');status.className='level-status';status.textContent=done?'✓':available?'→':'🔒';button.append(badge,body,status);button.addEventListener('click',()=>{if(!available)return;selectedLevelNumber=number;openInstrumentChooser('level')});list.append(button)});
}
function updatePracticeTempo(value){const tempo=Math.max(50,Math.min(150,Math.round(Number(value)/5)*5));playerProgress.settings.practiceTempo=tempo;document.querySelector('#settings-practice-tempo').value=String(tempo);document.querySelector('#practice-tempo-picker').value=String(tempo);document.querySelector('#practice-tempo-value').textContent=`${tempo}%`;savePlayerProgress()}
function applySavedSettings(){
  const volume=Math.max(0,Math.min(100,Number(playerProgress.settings.volume)||0)),tempo=Math.max(50,Math.min(150,Number(playerProgress.settings.practiceTempo)||100)),advanced=!!playerProgress.settings.advancedMode||playerProgress.settings.clarinetControlMode==='physical'||playerProgress.settings.violinControlMode==='advanced';document.querySelector('#volume-slider').value=String(volume);document.querySelector('#settings-volume').value=String(volume);document.querySelector('#settings-practice-tempo').value=String(tempo);document.querySelector('#practice-tempo-picker').value=String(tempo);document.querySelector('#practice-tempo-value').textContent=`${tempo}%`;document.querySelector('#settings-metronome').checked=!!playerProgress.settings.metronomeEnabled;document.querySelector('#metronome-picker').checked=!!playerProgress.settings.metronomeEnabled;document.querySelector('#advanced-mode').checked=advanced;player.classList.toggle('advanced-mode',advanced);playerProgress.settings.advancedMode=advanced;document.querySelector('#rhythm-difficulty').value=playerProgress.settings.rhythmDifficulty==='advanced'?'advanced':'easy';currentClarinetKeyboardMode=playerProgress.settings.clarinetControlMode==='physical'?'physical':'notes';currentViolinKeyboardMode=playerProgress.settings.violinControlMode==='advanced'?'advanced':'easy';applyLastInstrumentPreference();ensureDailyChallenge();
}
function todayStamp(){const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
function ensureDailyChallenge(){const challenge=playerProgress.dailyChallenge,today=todayStamp();if(challenge.date===today)return challenge;const instruments=Object.keys(info),dayNumber=Math.floor(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7))-1,Number(today.slice(8,10)))/86400000);playerProgress.dailyChallenge={date:today,instrument:instruments[dayNumber%instruments.length],goal:10,progress:0,completed:false};savePlayerProgress();return playerProgress.dailyChallenge}
function renderDailyChallenge(){const challenge=ensureDailyChallenge(),item=info[challenge.instrument],date=new Date(`${challenge.date}T12:00:00`);document.querySelector('#daily-challenge-date').textContent=date.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});document.querySelector('#daily-challenge-title').textContent=`Play ${challenge.goal} notes on ${item.name}`;document.querySelector('#daily-challenge-copy').textContent=`Make ${challenge.goal} sounds in Free Play today. Finish to earn 100 Music Points.`;document.querySelector('#daily-challenge-progress').textContent=challenge.completed?`Complete · ${challenge.goal}/${challenge.goal} notes · reward earned`:`Progress · ${challenge.progress}/${challenge.goal} notes`;document.querySelector('#daily-challenge-progress-bar').style.width=`${Math.min(100,challenge.progress/challenge.goal*100)}%`;document.querySelector('#daily-challenge-start').disabled=challenge.completed;document.querySelector('#daily-challenge-start').textContent=challenge.completed?'Completed today':'Start challenge';document.querySelector('#daily-challenge-reward').textContent=`Music Points · ${playerProgress.stats.challengePoints||0} total`}
function updateDailyChallengeProgress(instrument){if(appFlow!=='daily-challenge')return;const challenge=ensureDailyChallenge();if(challenge.completed||instrument!==challenge.instrument)return;challenge.progress=Math.min(challenge.goal,challenge.progress+1);if(challenge.progress>=challenge.goal){challenge.completed=true;playerProgress.stats.challengePoints=(playerProgress.stats.challengePoints||0)+100;document.querySelector('#daily-challenge-banner-copy').textContent='Challenge complete · +100 Music Points';unlockAchievement('daily-streak')}else document.querySelector('#daily-challenge-banner-copy').textContent=`Daily challenge · ${challenge.progress}/${challenge.goal} notes · ${info[instrument].name}`;const progress=document.querySelector('#daily-challenge-banner-progress');progress.max=challenge.goal;progress.value=challenge.progress;renderDailyChallenge();savePlayerProgress()}
const compositionsStorageKey='instrument-testing-compositions-v1';
function loadCompositions(){try{const saved=JSON.parse(localStorage.getItem(compositionsStorageKey)||'[]');return Array.isArray(saved)?saved.filter(song=>song&&Array.isArray(song.events)&&info[song.instrument]):[]}catch{return []}}
function saveCompositions(songs){try{localStorage.setItem(compositionsStorageKey,JSON.stringify(songs.slice(0,30)));return true}catch(error){console.warn('Compositions could not be saved in this browser',error);return false}}
const sheetProjectsStorageKey='instrument-testing-sheet-projects-v1';
const sheetLetterOrder=['C','D','E','F','G','A','B'],sheetSemitones={C:0,D:2,E:4,F:5,G:7,A:9,B:11},sheetKeySignatureCounts={C:0,G:1,D:2,A:3,E:4,B:5,'F#':6,'C#':7,F:-1,Bb:-2,Eb:-3,Ab:-4,Db:-5,Gb:-6,Cb:-7};
const sheetSharpOrder=[['F',5],['C',5],['G',5],['D',5],['A',4],['E',5],['B',4]],sheetFlatOrder=[['B',4],['E',5],['A',4],['D',5],['G',4],['C',5],['F',4]];
const sheetBassSharpOrder=[['F',3],['C',3],['G',3],['D',3],['A',2],['E',3],['B',2]],sheetBassFlatOrder=[['B',2],['E',3],['A',2],['D',3],['G',2],['C',3],['F',2]];
const sheetDurationLabels={4:'Whole',2:'Half',1:'Quarter',0.5:'Eighth',0.25:'Sixteenth',0.125:'Thirty-second'},sheetStaffStepHeight=10,sheetStaffLineSpacing=20;
const sheetDotMultipliers=[1,1.5,1.75];
const sheetDynamicGains={pp:.42,p:.56,mp:.72,mf:1,f:1.22,ff:1.42};
let sheetNotes=[],selectedSheetNoteId=null,copiedSheetNote=null,sheetProjectId=null,sheetUndoStack=[],sheetRedoStack=[],sheetPlaybackSession=null,sheetPreviewClientPoint=null,sheetDragState=null;
let sheetLinkDraft=null;
let sheetRenderedClef='treble';
function sheetClone(value){return JSON.parse(JSON.stringify(value))}
function sheetInstrument(){return document.querySelector('#sheet-instrument').value}
function sheetClef(){return document.querySelector('#sheet-clef').value}
function sheetTimeSignature(){return document.querySelector('#sheet-time-signature').value}
function sheetMeasureBeats(){const parts=sheetTimeSignature().split('/').map(Number);return parts[0]*4/parts[1]}
function sheetNoteValue(base,dots=0,triplet=false){
  const baseBeats=Object.hasOwn(sheetDurationLabels,base)?Number(base):1;
  const dotCount=Object.hasOwn(sheetDotMultipliers,dots)?Number(dots):0;
  const value={baseBeats,dots:dotCount,durationBeats:baseBeats*sheetDotMultipliers[dotCount]};
  if(triplet){value.triplet=true;value.durationBeats*=2/3}
  return value;
}
function sheetReadNoteValue(note){
  if(Object.hasOwn(sheetDurationLabels,note.baseBeats))return sheetNoteValue(note.baseBeats,note.dots,note.triplet);
  for(const base of Object.keys(sheetDurationLabels)){
    for(let dots=0;dots<sheetDotMultipliers.length;dots++){
      const value=sheetNoteValue(base,dots);
      if(value.durationBeats===Number(note.durationBeats))return value;
    }
  }
  return sheetNoteValue(1);
}
function sheetToolbarNoteValue(){
  return sheetNoteValue(document.querySelector('#sheet-duration').value,document.querySelector('#sheet-dots').value,document.querySelector('#sheet-triplet').checked);
}
function sheetNoteValueLabel(note){
  const {baseBeats,dots,triplet}=sheetReadNoteValue(note),base=sheetDurationLabels[baseBeats];
  const value=dots===2?'Double-dotted '+base.toLowerCase():dots===1?'Dotted '+base.toLowerCase():base;
  return triplet?value+' triplet':value;
}
function sheetFlagCount(baseBeats){
  return Math.max(0,Math.round(-Math.log2(baseBeats)));
}
function sheetSameBeat(a,b){
  return Math.abs(a-b)<1e-7;
}
function sheetCanTie(source,target){
  return !!(source&&target&&!source.rest&&!target.rest&&source.step===target.step
    &&target.beat>source.beat
    &&sheetSameBeat(source.beat+source.durationBeats,target.beat)
    &&(target.accidental==null||target.accidental==='none'||source.midi===target.midi));
}
function sheetBeamGroups(notes,timeSignature){
  const [count,denominator]=timeSignature.split('/').map(Number);
  const unit=4/denominator,measureBeats=count*unit;
  const groupBeats=denominator>=8&&count>=6&&count%3===0?unit*3:unit;
  const groups=[];
  let run=[];
  const close=()=>{
    if(run.length>1)groups.push(run);
    run=[];
  };
  for(const note of notes){
    const previous=run.at(-1);
    if(note.rest||!sheetFlagCount(sheetReadNoteValue(note).baseBeats)){
      close();
      continue;
    }
    const measure=Math.floor((note.beat+1e-7)/measureBeats);
    const previousMeasure=previous&&Math.floor((previous.beat+1e-7)/measureBeats);
    const bucket=beat=>Math.floor((beat-measure*measureBeats+1e-7)/groupBeats);
    if(previous&&(measure!==previousMeasure||note.beamMode==='break'
      ||!sheetSameBeat(previous.beat+previous.durationBeats,note.beat)
      ||(note.beamMode!=='join'&&bucket(previous.beat)!==bucket(note.beat))))close();
    run.push(note);
  }
  close();
  return groups;
}
function sheetPlaybackChains(notes){
  const incoming=new Map(),byId=new Map(notes.map(note=>[note.id,note]));
  for(const source of notes){
    const target=byId.get(source.tieTo);
    if(sheetCanTie(source,target)&&source.midi===target.midi&&!incoming.has(target.id))incoming.set(target.id,source.id);
  }
  return notes.filter(note=>!incoming.has(note.id)).map(note=>{
    const members=[note];
    let current=note;
    while(current.tieTo&&incoming.get(current.tieTo)===current.id){
      current=byId.get(current.tieTo);
      members.push(current);
    }
    return {members,start:note.beat,end:current.beat+current.durationBeats};
  });
}
function sheetTripletGroups(notes){
  const groups=[],run=[];
  for(const note of notes){
    const previous=run.at(-1);
    if(!note.triplet||(previous&&(!sheetSameBeat(previous.beat+previous.durationBeats,note.beat)
      ||!sheetSameBeat(previous.durationBeats,note.durationBeats))))run.length=0;
    if(!note.triplet)continue;
    run.push(note);
    if(run.length===3)groups.push(run.splice(0));
  }
  return groups;
}
function sheetMeasureMarks(notes,measureBeats){
  const marks=new Map();
  for(const note of notes){
    const measure=Math.floor((note.beat+1e-7)/measureBeats);
    const mark=marks.get(measure)||{};
    if(note.repeatStart)mark.repeatStart=true;
    if(note.repeatEnd)mark.repeatEnd=true;
    if(note.ending)mark.ending=note.ending;
    marks.set(measure,mark);
  }
  return marks;
}
function sheetRenderRepeat(svg,x,top,bottom,direction){
  for(const [offset,weight] of [[0,4],[6,1.6]]){
    svg.append(sheetSvgElement('line',{x1:x+offset*direction,y1:top,x2:x+offset*direction,y2:bottom,class:'sheet-repeat-bar','stroke-width':weight}));
  }
  for(const dy of [30,50])svg.append(sheetSvgElement('circle',{cx:x+12*direction,cy:top+dy,r:2.8,class:'sheet-repeat-dot'}));
}
function sheetBuildClock(notes,initialBpm){
  const tempos=new Map([[0,initialBpm]]),holds=new Map();
  for(const note of notes)if(note.tempo)tempos.set(note.beat,note.tempo);
  const orderedTempos=[...tempos].sort((a,b)=>a[0]-b[0]);
  const writtenTime=beat=>{
    let start=0,bpm=initialBpm,ms=0;
    for(const [at,next] of orderedTempos){
      if(at>beat)break;
      ms+=(at-start)*60000/bpm;
      start=at;
      bpm=next;
    }
    return ms+(beat-start)*60000/bpm;
  };
  for(const note of notes){
    if(note.articulation!=='fermata')continue;
    const end=note.beat+note.durationBeats,hold=(writtenTime(end)-writtenTime(note.beat))*.5;
    holds.set(end,Math.max(holds.get(end)||0,hold));
  }
  const holdPoints=[...holds];
  return beat=>writtenTime(beat)+holdPoints.reduce((ms,[at,hold])=>ms+(at<=beat+1e-7?hold:0),0);
}
function sheetBuildGains(notes,measureBeats){
  const gains=new Map();
  let gain=1,ramp=null;
  for(const [index,note] of notes.entries()){
    if(ramp){
      const position=Math.max(0,Math.min(1,(note.beat-ramp.from)/(ramp.to-ramp.from)));
      gain=ramp.start+(ramp.end-ramp.start)*position;
      if(position===1)ramp=null;
    }
    if(Object.hasOwn(sheetDynamicGains,note.dynamic)){gain=sheetDynamicGains[note.dynamic];ramp=null}
    if(note.hairpin){
      const next=notes.slice(index+1).find(item=>item.beat>note.beat&&Object.hasOwn(sheetDynamicGains,item.dynamic));
      const endpoint=next?.beat??(Math.floor(note.beat/measureBeats)+1)*measureBeats;
      const end=next?sheetDynamicGains[next.dynamic]:Math.min(1.5,Math.max(.3,gain+(note.hairpin==='crescendo'?.3:-.3)));
      ramp={from:note.beat,to:endpoint,start:gain,end};
    }
    gains.set(note.id,gain);
  }
  return gains;
}
function sheetPitchAtStep(step,clef=sheetClef()){
  const baseLetterIndex=clef==='bass'?4:2,baseOctave=clef==='bass'?2:4,total=baseLetterIndex+step,letterIndex=((total%7)+7)%7,octave=baseOctave+Math.floor(total/7),letter=sheetLetterOrder[letterIndex];
  return {letter,octave,naturalMidi:12*(octave+1)+sheetSemitones[letter]};
}
function sheetStaffStepForPitch(letter,octave,clef=sheetClef()){
  const base=clef==='bass'?18:30;
  return octave*7+sheetLetterOrder.indexOf(letter)-base;
}
function sheetKeyAlterations(clef=sheetClef(),keySignature=document.querySelector('#sheet-key-signature').value){
  const count=sheetKeySignatureCounts[keySignature]||0,order=clef==='bass'?(count>0?sheetBassSharpOrder:sheetBassFlatOrder):(count>0?sheetSharpOrder:sheetFlatOrder),alterations={};
  order.slice(0,Math.abs(count)).forEach(([letter])=>alterations[letter]=count>0?1:-1);return alterations;
}
function sheetResolveNotes(notes=sheetNotes,settings={}){
  const clef=settings.clef||sheetClef(),keySignature=settings.keySignature||document.querySelector('#sheet-key-signature').value,timeSignature=settings.timeSignature||sheetTimeSignature(),timeParts=timeSignature.split('/').map(Number),measureBeats=timeParts[0]*4/timeParts[1],keyAlterations=sheetKeyAlterations(clef,keySignature),accidentalCarry=new Map(),resolved=[],tieSources=new Map();let currentMeasure=-1;
  [...notes].sort((a,b)=>a.beat-b.beat||a.step-b.step).forEach(note=>{
    const measure=Math.floor((note.beat+1e-7)/measureBeats);if(measure!==currentMeasure){currentMeasure=measure;accidentalCarry.clear()}
    if(note.rest){resolved.push({...note,letter:null,octave:null,midi:null,label:'Rest'});return}
    const pitch=sheetPitchAtStep(note.step,clef),carryKey=pitch.letter+pitch.octave,explicit=note.accidental||'none';let alteration;
    if(explicit==='sharp')alteration=1;else if(explicit==='flat')alteration=-1;else if(explicit==='natural')alteration=0;else alteration=accidentalCarry.has(carryKey)?accidentalCarry.get(carryKey):(keyAlterations[pitch.letter]||0);
    if(explicit!=='none')accidentalCarry.set(carryKey,alteration);
    const source=tieSources.get(note.id);
    if(explicit==='none'&&sheetCanTie(source,note))alteration=source.midi-pitch.naturalMidi;
    const symbol=alteration===1?'♯':alteration===-1?'♭':'',label=pitch.letter+symbol+pitch.octave;
    const result={...note,letter:pitch.letter,octave:pitch.octave,midi:pitch.naturalMidi+alteration,label};
    resolved.push(result);
    if(note.tieTo&&!tieSources.has(note.tieTo))tieSources.set(note.tieTo,result);
  });
  return resolved;
}
function sheetStaffGeometry(notes=sheetNotes){
  const steps=notes.filter(note=>!note.rest).map(note=>Number(note.step)||0);
  const minStep=Math.min(-6,...steps),maxStep=Math.max(14,...steps);
  const top=132+(maxStep-14)*sheetStaffStepHeight,bottom=top+4*sheetStaffLineSpacing;
  const height=bottom+Math.max(76,-minStep*sheetStaffStepHeight+42);
  const measureBeats=sheetMeasureBeats(),left=210,measureWidth=20+measureBeats*144;
  const zoom=(Number(document.querySelector('#sheet-zoom')?.value)||100)/100;
  const viewport=document.querySelector('#sheet-staff')?.parentElement?.clientWidth||1440;
  const measuresPerSystem=Math.max(1,Math.min(4,Math.floor((viewport/zoom-left-24)/measureWidth)));
  const lastMeasure=notes.reduce((max,note)=>Math.max(max,Math.floor((note.beat+1e-7)/measureBeats),Math.ceil((note.beat+note.durationBeats-1e-7)/measureBeats)-1),0);
  const systemCount=Math.ceil(Math.max(2,lastMeasure+2)/measuresPerSystem);
  return {top,bottom,height,minStep,maxStep,stepHeight:sheetStaffStepHeight,lineSpacing:sheetStaffLineSpacing,left,measureWidth,measureBeats,zoom,measuresPerSystem,systemCount,
    width:left+measuresPerSystem*measureWidth+24};
}
function sheetStepToY(step,layout=sheetStaffGeometry()){
  return layout.bottom-Number(step)*layout.stepHeight;
}
function sheetYToStep(y,layout=sheetStaffGeometry()){
  return Math.round((layout.bottom-Number(y))/layout.stepHeight);
}
function sheetLedgerSteps(step){
  const value=Number(step);if(!Number.isFinite(value)||value>=-1&&value<=9)return [];
  const first=value<0?-2:10,steps=[];
  for(let ledger=first;value<0?ledger>=value:ledger<=value;ledger+=value<0?-2:2)steps.push(ledger);
  return steps;
}
function sheetBeatToX(beat,layout=sheetStaffGeometry()){
  const measure=Math.floor((beat+1e-7)/layout.measureBeats),beatInMeasure=beat-measure*layout.measureBeats;
  return layout.left+(measure%(layout.measuresPerSystem||Infinity))*layout.measureWidth+10+beatInMeasure/layout.measureBeats*(layout.measureWidth-20);
}
function sheetBeatSystem(beat,layout){
  return Math.floor((beat+1e-7)/(layout.measureBeats*(layout.measuresPerSystem||Infinity)));
}
function sheetStaffPoint(event){
  const svg=document.querySelector('#sheet-staff'),matrix=svg?.getScreenCTM();if(!svg||!matrix)return null;
  try{const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
    const local=point.matrixTransform(matrix.inverse());return Number.isFinite(local.x)&&Number.isFinite(local.y)?{x:local.x,y:local.y}:null
  }catch{return null}
}
function sheetNoteHitTarget(target){
  const hit=target?.closest?.('.sheet-notehead,.sheet-note-label,.sheet-rest-glyph,.sheet-rest-block');
  return hit?.closest('[data-sheet-note-id]')||null;
}
function sheetSnapPoint(event,layout=sheetStaffGeometry()){
  const local=sheetStaffPoint(event);
  if(!local||local.y<0||local.x<layout.left)return null;
  const row=Math.floor(local.y/layout.height),localY=local.y-row*layout.height;
  const column=Math.floor((local.x-layout.left)/layout.measureWidth);
  const step=sheetYToStep(localY,layout);
  if(row>=layout.systemCount||column>=layout.measuresPerSystem||step<layout.minStep||step>layout.maxStep)return null;
  const measure=row*layout.measuresPerSystem+column;
  const xInMeasure=local.x-layout.left-column*layout.measureWidth;
  const start=measure*layout.measureBeats,end=start+layout.measureBeats;
  const rawBeat=start+(xInMeasure-10)/(layout.measureWidth-20)*layout.measureBeats;
  const division=Number(document.querySelector('#sheet-grid')?.value)||(document.querySelector('#sheet-triplet')?.checked?12:8);
  let beat=Math.max(start,Math.min(end-1/division,Math.round(rawBeat*division)/division));
  for(const note of sheetNotes){
    const next=note.beat+note.durationBeats;
    if(next>=start&&next<end&&Math.abs(rawBeat-next)<Math.abs(rawBeat-beat))beat=next;
  }
  return {x:sheetBeatToX(beat,layout),beat,step};
}
function sheetPreviewLabel(position){
  const preview={...position,id:'sheet-preview'};
  const notes=position.excludeId?sheetNotes.filter(item=>item.id!==position.excludeId):sheetNotes;
  const note=sheetResolveNotes([...notes,preview]).find(item=>item.id===preview.id);
  if(note&&!note.rest&&sheetInstrument()==='drums')return sheetDrumLabel(sheetDrumPartForMidi(note.midi));
  return note?.label||'';
}
function updateSheetPreview(position){
  const svg=document.querySelector('#sheet-staff'),group=svg?.querySelector('#sheet-note-preview');if(!group)return;
  if(!position){group.setAttribute('visibility','hidden');return}
  const layout=sheetStaffGeometry(),moving=sheetNotes.find(note=>note.id===position.excludeId);
  const preview=moving?{...moving,...position}:sheetEntryAt(position);
  const y=sheetStepToY(preview.rest?(preview.voice===2?2:4):preview.step,layout)+sheetBeatSystem(preview.beat,layout)*layout.height;
  const previewId='sheet-ghost',row=sheetBeatSystem(preview.beat,layout);
  const rowNotes=sheetNotes.filter(note=>note.id!==position.excludeId&&sheetBeatSystem(note.beat,layout)===row);
  const {headOffsets}=sheetChordLayout([...rowNotes,{...preview,id:previewId}],layout);
  const x=sheetBeatToX(preview.beat,layout)+(headOffsets.get(previewId)||0),label=sheetPreviewLabel(preview);
  group.setAttribute('transform',`translate(${x} ${y})`);
  group.setAttribute('visibility','visible');
  const {baseBeats}=sheetReadNoteValue(preview);
  group.replaceChildren();
  if(preview.rest){
    if(baseBeats>=2)group.append(sheetSvgElement('rect',{x:-8,y:baseBeats===4?-20:-8,width:16,height:8,rx:1,class:'sheet-rest-block'}));
    else group.append(sheetSvgElement('text',{x:-7,y:11,class:'sheet-rest-glyph'},{1:'𝄽',0.5:'𝄾',0.25:'𝄿',0.125:'𝅀'}[baseBeats]));
  }else{
    for(const ledger of sheetLedgerSteps(preview.step)){
      const ledgerY=(preview.step-ledger)*layout.stepHeight;
      group.append(sheetSvgElement('line',{x1:-14,x2:14,y1:ledgerY,y2:ledgerY,class:'sheet-ledger-line'}));
    }
    group.append(sheetSvgElement('ellipse',{cx:0,cy:0,rx:9,ry:6,transform:'rotate(-18 0 0)',class:'sheet-notehead'+(baseBeats>=2?' hollow':'')}));
  }
  group.append(sheetSvgElement('text',{x:15,y:-5,class:'sheet-note-label'},label));
}
function sheetCanMoveTo(note,beat,step,notes=sheetNotes){
  return notes.every(other=>{
    if(other.id===note.id||(other.voice||1)!==(note.voice||1))return true;
    if(sheetSameBeat(other.beat,beat)&&!other.rest&&!note.rest&&other.step!==step&&sheetSameBeat(other.durationBeats,note.durationBeats))return true;
    return other.beat+other.durationBeats<=beat+1e-7||beat+note.durationBeats<=other.beat+1e-7;
  });
}
function sheetDragTarget(event,local,note){
  const layout=sheetStaffGeometry(),row=sheetBeatSystem(note.beat,layout);
  const y=Math.max(0,Math.min(layout.height,local.y-row*layout.height));
  const pitch=note.rest?note.step:Math.max(layout.minStep,Math.min(layout.maxStep,sheetYToStep(y,layout)));
  const target=document.querySelector('#sheet-horizontal')?.checked&&sheetSnapPoint(event,layout);
  const beat=target&&sheetCanMoveTo(note,target.beat,target.step)?target.beat:note.beat;
  let step=note.rest?note.step:beat!==note.beat?target.step:pitch;
  if(sheetNotes.some(other=>other.id!==note.id&&(other.voice||1)===(note.voice||1)&&sheetSameBeat(other.beat,beat)&&!other.rest&&other.step===step))step=note.step;
  return {x:sheetBeatToX(beat,layout),beat,step,excludeId:note.id};
}
function sheetHandlePointerMove(event){
  if(sheetLinkDraft||document.querySelector('#sheet-eraser')?.checked){updateSheetPreview(null);return}
  sheetPreviewClientPoint={x:event.clientX,y:event.clientY};
  const local=sheetStaffPoint(event);if(!local)return;
  if(sheetDragState){
    const note=sheetNotes.find(item=>item.id===sheetDragState.id);if(!note)return;
    if(event.pointerId!==sheetDragState.pointerId)return;
    if(Math.abs(local.y-sheetDragState.startY)>3||(document.querySelector('#sheet-horizontal').checked&&Math.abs(local.x-sheetDragState.startX)>3))sheetDragState.moved=true;
    if(sheetDragState.moved){updateSheetPreview(sheetDragTarget(event,local,note));return}
  }
  updateSheetPreview(sheetNoteHitTarget(event.target)?null:sheetSnapPoint(event));
}
function sheetHandlePointerUp(event){
  if(!sheetDragState||event.pointerId!==sheetDragState.pointerId)return;
  const drag=sheetDragState,note=sheetNotes.find(item=>item.id===drag.id),local=sheetStaffPoint(event);
  if(note&&local&&(drag.moved||Math.abs(local.y-drag.startY)>3||(document.querySelector('#sheet-horizontal')?.checked&&Math.abs(local.x-drag.startX)>3)))drag.moved=true;
  const target=note&&local&&drag.moved?sheetDragTarget(event,local,note):null;
  sheetDragState=null;
  if(target&&(target.step!==note.step||target.beat!==note.beat)){sheetPushUndo();note.step=target.step;note.beat=target.beat;selectedSheetNoteId=note.id;sheetPreviewClientPoint=null;renderSheetStaff();document.querySelector('#sheet-current-note').textContent='Moved '+sheetResolveNotes().find(item=>item.id===note.id)?.label;updateSheetEditButtons();return}
  if(note&&!drag.moved){sheetPreviewClientPoint=null;sheetSelectOrLink(note.id);return}
  if(sheetNoteHitTarget(event.target)){sheetPreviewClientPoint=null;updateSheetPreview(null);return}
  sheetPreviewClientPoint={x:event.clientX,y:event.clientY};updateSheetPreview(sheetSnapPoint(event));
}
function sheetSvgElement(tag,attributes={},text=''){
  const element=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attributes).forEach(([name,value])=>element.setAttribute(name,String(value)));if(text!=='')element.textContent=text;return element;
}
function sheetRenderBeams(svg,groups,layout,hasTwoVoices=false){
  const stems=new Map();
  for(const group of groups){
    const direction=hasTwoVoices?(group[0].voice===2?-1:1):group.reduce((sum,note)=>sum+note.step,0)/group.length<4?1:-1;
    const ys=group.map(note=>sheetStepToY(note.step,layout));
    const y=(direction===1?Math.min(...ys):Math.max(...ys))-direction*36;
    const positions=group.map(note=>{
      const stem={x:sheetBeatToX(note.beat,layout)+direction*8,y,direction,level:sheetFlagCount(sheetReadNoteValue(note).baseBeats)};
      stems.set(note.id,stem);
      return stem;
    });
    for(let index=0;index<positions.length;index++){
      const stem=positions[index],previous=positions[index-1],next=positions[index+1];
      for(let level=1;level<=stem.level;level++){
        let endX;
        if(next?.level>=level)endX=next.x;
        else if(level>1&&!(previous?.level>=level))endX=stem.x+(next?1:-1)*9;
        else continue;
        const beamY=y+(level-1)*7*direction;
        svg.append(sheetSvgElement('line',{x1:stem.x,y1:beamY,x2:endX,y2:beamY,class:'sheet-beam'}));
      }
    }
  }
  return stems;
}
function sheetRenderLinks(svg,notes,layout,row=0){
  const byId=new Map(notes.map(note=>[note.id,note]));
  for(const note of notes){
    if(note.rest)continue;
    for(const [mark,id] of [['tie',note.tieTo],['slur',note.slurTo]]){
      const target=byId.get(id);
      if(!target||target.rest||target.beat<=note.beat||(mark==='tie'&&(!sheetCanTie(note,target)||note.midi!==target.midi)))continue;
      const startRow=sheetBeatSystem(note.beat,layout),endRow=sheetBeatSystem(target.beat,layout);
      if(row<startRow||row>endRow)continue;
      const x1=row===startRow?sheetBeatToX(note.beat,layout)+7:layout.left;
      const x2=row===endRow?sheetBeatToX(target.beat,layout)-7:layout.width-24;
      if(x2<=x1)continue;
      const direction=mark==='slur'?-1:note.step<4?1:-1;
      const y1=sheetStepToY(note.step,layout)+direction*(mark==='slur'?12:8);
      const y2=sheetStepToY(target.step,layout)+direction*(mark==='slur'?12:8);
      const lift=direction*(mark==='slur'?Math.min(42,18+(x2-x1)/6):11);
      const span=(x2-x1)/3;
      svg.append(sheetSvgElement('path',{d:`M ${x1} ${y1} C ${x1+span} ${y1+lift}, ${x2-span} ${y2+lift}, ${x2} ${y2}`,class:'sheet-'+mark}));
    }
  }
}
function sheetRenderExpression(svg,g,note,x,y,layout){
  const {top,bottom}=layout;
  const markY=note.rest?bottom+14:y+(note.step<4?13:-15);
  const articulation=SheetExpression.renderArticulation(sheetSvgElement,note.articulation,x,markY,note.step<4?-1:1);
  if(articulation)g.append(articulation);
  if(note.tempo)svg.append(sheetSvgElement('text',{x,y:top-25,class:'sheet-tempo-mark'},'♩ = '+note.tempo));
  if(note.dynamic)svg.append(sheetSvgElement('text',{x,y:bottom+43,class:'sheet-dynamic'},note.dynamic));
}
function sheetRenderTriplets(svg,notes,layout){
  const groups=[1,2].flatMap(voice=>sheetTripletGroups(notes.filter(note=>(note.voice||1)===voice)));
  const grouped=new Set(groups.flat().map(note=>note.id));
  for(const group of groups){
    const x1=sheetBeatToX(group[0].beat,layout),x2=sheetBeatToX(group[2].beat,layout),center=(x1+x2)/2;
    const y=Math.min(layout.top,...group.map(note=>sheetStepToY(note.rest?4:note.step,layout)))-44;
    const d=`M ${x1} ${y+5} V ${y} H ${center-8} M ${center+8} ${y} H ${x2} V ${y+5}`;
    svg.append(sheetSvgElement('path',{d,class:'sheet-tuplet-bracket'}),sheetSvgElement('text',{x:center,y:y+4,class:'sheet-tuplet-number'},'3'));
  }
  for(const note of notes)if(note.triplet&&!grouped.has(note.id)){
    const x=sheetBeatToX(note.beat,layout),y=Math.min(layout.top,sheetStepToY(note.rest?4:note.step,layout))-40;
    svg.append(sheetSvgElement('text',{x,y,class:'sheet-tuplet-number'},'3'));
  }
}
function sheetChordLayout(notes,layout){
  const chordMembers=new Map();
  for(const note of notes){
    if(note.rest)continue;
    const key=`${note.beat}/${note.voice||1}/${note.durationBeats}`;
    if(!chordMembers.has(key))chordMembers.set(key,[]);
    chordMembers.get(key).push(note);
  }
  const headOffsets=new Map(),chordStems=new Map(),hasTwoVoices=notes.some(note=>note.voice===2);
  for(const chord of chordMembers.values()){
    const direction=chord[0].voice===2?-1:hasTwoVoices?1:chord.reduce((sum,note)=>sum+note.step,0)/chord.length<4?1:-1;
    const ordered=[...chord].sort((a,b)=>direction*(a.step-b.step));
    let offset=0;
    for(const [index,note] of ordered.entries()){
      offset=index&&Math.abs(note.step-ordered[index-1].step)===1?(offset?0:direction*15):0;
      headOffsets.set(note.id,offset);
      if(chord.length>1)chordStems.set(note.id,{direction,draw:index===0,end:sheetStepToY(ordered.at(-1).step,layout)-direction*36});
    }
  }
  return {headOffsets,chordStems,hasTwoVoices};
}
function renderSheetStaff(){
  const svg=document.querySelector('#sheet-staff');if(!svg)return;
  sheetRenderedClef=sheetClef();
  const layout=sheetStaffGeometry(),{width,height,systemCount,zoom}=layout;
  const resolved=sheetResolveNotes(),marks=sheetMeasureMarks(resolved,layout.measureBeats);
  svg.replaceChildren();
  svg.setAttribute('viewBox',`0 0 ${width} ${height*systemCount}`);
  svg.setAttribute('width',width*zoom);
  svg.setAttribute('height',height*systemCount*zoom);
  svg.classList.toggle('hide-note-names',!document.querySelector('#sheet-note-names').checked);
  const title=document.querySelector('#sheet-title').value.trim()||'Untitled song',composer=document.querySelector('#sheet-composer-name').value.trim();
  for(let row=0;row<systemCount;row++){
    const system=sheetSvgElement('g',{class:'sheet-system',transform:`translate(0 ${row*height})`});
    system.append(sheetSvgElement('rect',{width,height,class:'sheet-page-background'}));
    if(row===0){
      system.append(sheetSvgElement('text',{x:width/2,y:22,'text-anchor':'middle',class:'sheet-svg-title'},title));
      if(composer)system.append(sheetSvgElement('text',{x:width/2,y:42,'text-anchor':'middle',class:'sheet-svg-composer'},composer));
    }
    sheetRenderSystem(system,layout,resolved,row,marks);
    svg.append(system);
  }
  const cursor=sheetSvgElement('line',{id:'sheet-playhead',class:'sheet-playhead',visibility:'hidden'});
  svg.append(cursor);
  const preview=sheetSvgElement('g',{id:'sheet-note-preview',class:'sheet-note-preview','pointer-events':'none',visibility:'hidden'});
  preview.append(sheetSvgElement('ellipse',{cx:0,cy:0,rx:9,ry:6,transform:'rotate(-18 0 0)',class:'sheet-notehead'}),sheetSvgElement('text',{x:0,y:23,'text-anchor':'middle',class:'sheet-note-label'},''));
  svg.append(preview);
  if(sheetPreviewClientPoint)updateSheetPreview(sheetSnapPoint({clientX:sheetPreviewClientPoint.x,clientY:sheetPreviewClientPoint.y},layout));
  svg.setAttribute('aria-label',title+' sheet music staff · '+sheetClef()+' clef · '+sheetTimeSignature());
}
function sheetRenderSystem(svg,layout,allNotes,row,marks){
  const clef=sheetClef(),{top,bottom,width,measureBeats,measureWidth,left,measuresPerSystem}=layout;
  const firstMeasure=row*measuresPerSystem;
  const resolved=allNotes.filter(note=>sheetBeatSystem(note.beat,layout)===row);
  for(let index=0;index<5;index++){const y=top+index*layout.lineSpacing;svg.append(sheetSvgElement('line',{x1:18,y1:y,x2:width-12,y2:y,class:'sheet-staff-line'}))}
  const clefText=clef==='bass'?'𝄢':'𝄞';svg.append(sheetSvgElement('text',{x:23,y:top+74,class:'sheet-clef-glyph'},clefText));
  const keyCount=sheetKeySignatureCounts[document.querySelector('#sheet-key-signature').value]||0;
  if(keyCount){const list=clef==='bass'?(keyCount>0?sheetBassSharpOrder:sheetBassFlatOrder):(keyCount>0?sheetSharpOrder:sheetFlatOrder);list.slice(0,Math.abs(keyCount)).forEach((entry,index)=>{const step=sheetStaffStepForPitch(entry[0],entry[1],clef),y=sheetStepToY(step,layout);svg.append(sheetSvgElement('text',{x:70+index*13,y:y+5,class:'sheet-key-symbol'},keyCount>0?'♯':'♭'))})}
  const signatureX=70+Math.abs(keyCount)*13+8,signature=sheetTimeSignature().split('/');
  svg.append(sheetSvgElement('text',{x:signatureX,y:top+29,class:'sheet-time-symbol'},signature[0]));svg.append(sheetSvgElement('text',{x:signatureX,y:bottom-1,class:'sheet-time-symbol'},signature[1]));
  for(let measure=0;measure<=measuresPerSystem;measure++){
    const x=left+measure*measureWidth;svg.append(sheetSvgElement('line',{x1:x,y1:top,x2:x,y2:bottom,class:'sheet-bar-line'}));
    if(measure>=measuresPerSystem)continue;
    const number=firstMeasure+measure,mark=marks.get(number);
    svg.append(sheetSvgElement('text',{x:x+6,y:top-7,class:'sheet-measure-number'},String(number+1)));
    if(mark?.repeatStart)sheetRenderRepeat(svg,x,top,bottom,1);
    if(mark?.repeatEnd)sheetRenderRepeat(svg,x+measureWidth,top,bottom,-1);
    if(mark?.ending){
      const y=top-42;
      svg.append(sheetSvgElement('path',{d:`M ${x+2} ${y+12} V ${y} H ${x+measureWidth-2}`,class:'sheet-volta'}));
      svg.append(sheetSvgElement('text',{x:x+8,y:y+13,class:'sheet-tempo-mark'},mark.ending+'.'));
    }
  }
  const {headOffsets,chordStems,hasTwoVoices}=sheetChordLayout(resolved,layout);
  const notesWithStems=resolved.filter(note=>chordStems.get(note.id)?.draw!==false);
  const beams=[1,2].flatMap(voice=>sheetBeamGroups(notesWithStems.filter(note=>(note.voice||1)===voice),sheetTimeSignature()));
  const beamStems=sheetRenderBeams(svg,beams,layout,hasTwoVoices);
  resolved.forEach(note=>{
    const offset=headOffsets.get(note.id)||0;
    const x=sheetBeatToX(note.beat,layout)+offset,step=note.rest?(note.voice===2?2:4):note.step,y=sheetStepToY(step,layout);
    const {baseBeats,dots}=sheetReadNoteValue(note),valueLabel=sheetNoteValueLabel(note);
    const displayLabel=note.rest?'Rest':sheetInstrument()==='drums'?sheetDrumLabel(sheetDrumPartForMidi(note.midi)):note.label;
    const playing=sheetPlaybackSession?.highlighted?.has(note.id);
    const g=sheetSvgElement('g',{class:'sheet-note'+(note.id===selectedSheetNoteId?' selected':'')+(playing?' playing':''),'data-sheet-note-id':note.id,tabindex:0,role:'button','aria-label':'Select '+displayLabel+' · '+valueLabel});
    const titleElement=sheetSvgElement('title',{},displayLabel+' · '+valueLabel);
    g.append(titleElement);
    if(!note.rest)sheetLedgerSteps(step).forEach(ledger=>{const ledgerY=sheetStepToY(ledger,layout);g.append(sheetSvgElement('line',{x1:x-14,y1:ledgerY,x2:x+14,y2:ledgerY,class:'sheet-ledger-line'}))});
    if(note.rest){
      if(baseBeats>=2){g.append(sheetSvgElement('rect',{x:x-8,y:y+(baseBeats===4?-20:-8),width:16,height:8,rx:1,class:'sheet-rest-block'}))}
      else{const glyph={1:'𝄽',0.5:'𝄾',0.25:'𝄿',0.125:'𝅀'}[baseBeats];g.append(sheetSvgElement('text',{x:x-7,y:y+11,class:'sheet-rest-glyph'},glyph))}
    }else{
      if(note.accidental&&note.accidental!=='none'){const symbol=note.accidental==='sharp'?'♯':note.accidental==='flat'?'♭':'♮';g.append(sheetSvgElement('text',{x:x-19,y:y+5,class:'sheet-accidental-symbol'},symbol))}
      g.append(sheetSvgElement('ellipse',{cx:x,cy:y,rx:9,ry:6,transform:'rotate(-18 '+x+' '+y+')',class:'sheet-notehead'+(baseBeats>=2?' hollow':'')}));
      const chord=chordStems.get(note.id);
      if(baseBeats<4&&(!chord||chord.draw)){
        const beam=beamStems.get(note.id);
        const direction=beam?.direction??chord?.direction??(note.voice===2?-1:hasTwoVoices?1:step<4?1:-1);
        const stemX=beam?.x??x-offset+direction*8,stemEnd=beam?.y??chord?.end??y-direction*36;
        g.append(sheetSvgElement('line',{x1:stemX,y1:y-direction,x2:stemX,y2:stemEnd,class:'sheet-stem'}));
        for(let flag=0;!beam&&flag<sheetFlagCount(baseBeats);flag++){
          const flagY=stemEnd+flag*8*direction;
          const d=`M ${stemX} ${flagY} C ${stemX+direction*15} ${flagY+6*direction} ${stemX+direction*16} ${flagY+16*direction} ${stemX+direction*8} ${flagY+20*direction}`;
          g.append(sheetSvgElement('path',{d,class:'sheet-flag'}));
        }
      }
      const labelWidth=Math.max(24,displayLabel.length*6+8),labelX=x+12+dots*7,labelY=y-8;
      g.append(sheetSvgElement('rect',{x:labelX,y:labelY,width:labelWidth,height:15,rx:4,class:'sheet-note-label-bg'}),sheetSvgElement('text',{x:labelX+4,y:y+3,class:'sheet-note-label'},displayLabel));
    }
    for(let dot=0;dot<dots;dot++)g.append(sheetSvgElement('circle',{cx:x+14+dot*7,cy:note.rest?y-7:y-(step%2===0?layout.stepHeight:0),r:2.3,class:'sheet-augmentation-dot'}));
    sheetRenderExpression(svg,g,note,x,y,layout);
    g.addEventListener('pointerdown',event=>{
      if(sheetLinkDraft||sheetDragState||document.querySelector('#sheet-eraser').checked||!sheetNoteHitTarget(event.target)||event.pointerType==='mouse'&&event.button!==0)return;
      const local=sheetStaffPoint(event);if(!local)return;
      selectedSheetNoteId=note.id;
      sheetDragState={id:note.id,pointerId:event.pointerId,startX:local.x,startY:local.y,moved:false};
      try{g.setPointerCapture(event.pointerId)}catch{}
    });
    g.addEventListener('click',event=>{if(sheetNoteHitTarget(event.target)!==g)return;event.stopPropagation();sheetSelectOrLink(note.id)});g.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();sheetSelectOrLink(note.id)}});svg.append(g);
  });
  sheetRenderLinks(svg,allNotes,layout,row);
  sheetRenderTriplets(svg,resolved,layout);
  for(const note of resolved)if(note.hairpin){
    const endpoint=allNotes.find(item=>item.beat>note.beat&&item.dynamic)?.beat??(Math.floor(note.beat/measureBeats)+1)*measureBeats;
    const x1=sheetBeatToX(note.beat,layout)+(note.dynamic?20:0),x2=sheetBeatSystem(endpoint,layout)===row?sheetBeatToX(endpoint,layout)-6:width-24,y=bottom+54;
    if(x2>x1){
      const [open,closed]=note.hairpin==='crescendo'?[x2,x1]:[x1,x2];
      svg.append(sheetSvgElement('path',{d:`M ${open} ${y-5} L ${closed} ${y} L ${open} ${y+5}`,class:'sheet-tuplet-bracket'}));
    }
  }
}
function selectSheetNote(id){
  selectedSheetNoteId=id;
  const note=sheetNotes.find(item=>item.id===id),resolved=sheetResolveNotes().find(item=>item.id===id);
  if(note){
    const {baseBeats,dots}=sheetReadNoteValue(note);
    document.querySelector('#sheet-duration').value=String(baseBeats);
    document.querySelector('#sheet-dots').value=String(dots);
    document.querySelector('#sheet-triplet').checked=!!note.triplet;
    document.querySelector('#sheet-voice').value=String(note.voice||1);
    document.querySelector('#sheet-accidental').value=note.accidental||'none';
    const label=note.rest?'rest':sheetInstrument()==='drums'?sheetDrumLabel(sheetDrumPartForMidi(resolved.midi)):resolved?.label;
    document.querySelector('#sheet-current-note').textContent='Selected '+label+' · '+sheetNoteValueLabel(note);
  }
  updateSheetEditButtons();renderSheetStaff();
}
function sheetSnapshot(clef=sheetClef()){
  return {notes:sheetClone(sheetNotes),clef};
}
function sheetPushUndo(clef){
  sheetUndoStack.push(sheetSnapshot(clef));
  if(sheetUndoStack.length>80)sheetUndoStack.shift();
  sheetRedoStack=[];
  sheetUpdateHistoryButtons();
  if(sheetPlaybackSession)stopSheetPlayback();
}
function sheetUpdateHistoryButtons(){
  document.querySelector('#sheet-undo').disabled=!sheetUndoStack.length;
  document.querySelector('#sheet-redo').disabled=!sheetRedoStack.length;
}
function updateSheetEditButtons(){
  const note=sheetNotes.find(note=>note.id===selectedSheetNoteId),selected=!!note;
  sheetUpdateHistoryButtons();
  document.querySelector('#sheet-copy').disabled=!selected;document.querySelector('#sheet-delete-note').disabled=!selected;
  document.querySelector('#sheet-paste').disabled=!copiedSheetNote;
  document.querySelector('#sheet-apply-note').disabled=!selected;
  document.querySelector('#sheet-apply-expression').disabled=!selected;
  document.querySelector('#sheet-apply-measure').disabled=!selected;
  const measureBeats=sheetMeasureBeats();
  const marks=note&&sheetMeasureMarks(sheetNotes,measureBeats).get(Math.floor((note.beat+1e-7)/measureBeats));
  document.querySelector('#sheet-repeat-start').checked=!!marks?.repeatStart;
  document.querySelector('#sheet-repeat-end').checked=!!marks?.repeatEnd;
  document.querySelector('#sheet-ending').value=String(marks?.ending||0);
  for(const [id,property] of [['sheet-articulation','articulation'],['sheet-dynamic','dynamic'],['sheet-hairpin','hairpin'],['sheet-note-tempo','tempo']]){
    document.querySelector('#'+id).value=note?.[property]??'';
  }
  const beam=document.querySelector('#sheet-beam');
  beam.disabled=!note||note.rest||!sheetFlagCount(sheetReadNoteValue(note).baseBeats);
  beam.value=note?.beamMode||'auto';
  for(const id of ['sheet-tie','sheet-slur','sheet-remove-links'])document.querySelector('#'+id).disabled=(!note||note.rest)&&!sheetLinkDraft;
  document.querySelector('#sheet-link-hint').textContent=sheetLinkDraft
    ?'Select the ending note. Use Remove ties and slurs to cancel.'
    :'Select a note to edit beams, ties, or slurs.';
}
function sheetSelectOrLink(id){
  if(document.querySelector('#sheet-eraser').checked){
    selectedSheetNoteId=id;
    sheetDeleteSelected();
    return;
  }
  if(!sheetLinkDraft){selectSheetNote(id);return}
  const notes=sheetResolveNotes();
  const source=notes.find(note=>note.id===sheetLinkDraft.id),target=notes.find(note=>note.id===id);
  const isTie=sheetLinkDraft.mark==='tie';
  if(!source||!target||target.rest||target.beat<=source.beat||(isTie&&!sheetCanTie(source,target))){
    document.querySelector('#sheet-link-hint').textContent=isTie?'Choose the next note at the same pitch. A tie cannot cross a gap.':'Choose a later note to end the slur.';
    return;
  }
  sheetPushUndo();
  const property=isTie?'tieTo':'slurTo';
  if(isTie)for(const note of sheetNotes)if(note.tieTo===id)delete note.tieTo;
  sheetNotes.find(note=>note.id===source.id)[property]=id;
  sheetLinkDraft=null;
  selectSheetNote(source.id);
}
function sheetRemoveLinks(){
  if(sheetLinkDraft){sheetLinkDraft=null;updateSheetEditButtons();return}
  const note=sheetNotes.find(note=>note.id===selectedSheetNoteId);
  if(!note)return;
  sheetPushUndo();
  for(const item of sheetNotes){
    for(const property of ['tieTo','slurTo'])if(item===note||item[property]===note.id)delete item[property];
  }
  renderSheetStaff();
}
function sheetEntryAt(snapped){
  const {step}=snapped,rest=document.querySelector('#sheet-place-rest').checked;
  const chordNote=!rest&&document.querySelector('#sheet-chord').checked&&sheetNotes.find(item=>item.id===selectedSheetNoteId&&!item.rest);
  const beat=chordNote?chordNote.beat:snapped.beat;
  const value=chordNote?sheetReadNoteValue(chordNote):sheetToolbarNoteValue();
  const voice=chordNote?(chordNote.voice||1):Number(document.querySelector('#sheet-voice').value);
  return {beat,step,...value,voice,accidental:rest?'none':document.querySelector('#sheet-accidental').value,rest};
}
function sheetPlaceAt(event){
  const target=sheetNoteHitTarget(event.target);if(target){sheetSelectOrLink(target.getAttribute('data-sheet-note-id'));return}
  if(sheetLinkDraft||document.querySelector('#sheet-eraser').checked)return;
  const snapped=sheetSnapPoint(event);if(!snapped)return;
  const placement=sheetEntryAt(snapped);
  const {beat,step,voice,rest}=placement;
  if(sheetNotes.some(note=>sheetSameBeat(note.beat,beat)&&(note.voice||1)===voice&&(note.rest||rest||note.step===step))){
    document.querySelector('#sheet-status').textContent='That position is already used in this voice.';
    return;
  }
  sheetPushUndo();const note={id:'sheet-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),...placement};sheetNotes.push(note);selectedSheetNoteId=note.id;sheetPreviewClientPoint=null;
  const placed=sheetResolveNotes().find(item=>item.id===note.id),placedLabel=rest?'rest':sheetInstrument()==='drums'?sheetDrumLabel(sheetDrumPartForMidi(placed.midi)):placed.label;document.querySelector('#sheet-current-note').textContent='Added '+placedLabel+' · '+sheetNoteValueLabel(note);updateSheetEditButtons();renderSheetStaff();
}
function sheetApplyHistory(from,to,message){
  if(!from.length)return;
  if(sheetPlaybackSession)stopSheetPlayback();
  sheetLinkDraft=null;
  to.push(sheetSnapshot());
  const snapshot=from.pop();
  sheetNotes=snapshot.notes;
  document.querySelector('#sheet-clef').value=snapshot.clef;
  selectedSheetNoteId=null;
  updateSheetEditButtons();
  renderSheetStaff();
  document.querySelector('#sheet-status').textContent=message;
}
function sheetUndo(){sheetApplyHistory(sheetUndoStack,sheetRedoStack,'Undo complete.')}
function sheetRedo(){
  sheetApplyHistory(sheetRedoStack,sheetUndoStack,'Redo complete.');
}
function sheetChangeClef(){
  const previous=sheetRenderedClef,next=sheetClef();
  if(previous!==next){
    sheetPushUndo(previous);
    for(const note of sheetNotes){
      if(note.rest)continue;
      const {letter,octave}=sheetPitchAtStep(note.step,previous);
      note.step=sheetStaffStepForPitch(letter,octave,next);
    }
  }
  renderSheetStaff();
}
function sheetUpdateSelectedTool(){
  const note=sheetNotes.find(item=>item.id===selectedSheetNoteId);if(!note)return;
  sheetPushUndo();delete note.triplet;Object.assign(note,sheetToolbarNoteValue());
  note.voice=Number(document.querySelector('#sheet-voice').value);
  if(!note.rest)note.accidental=document.querySelector('#sheet-accidental').value;
  renderSheetStaff();document.querySelector('#sheet-status').textContent='Selected note updated.';
}
function sheetApplyExpression(){
  const note=sheetNotes.find(item=>item.id===selectedSheetNoteId);
  if(!note)return;
  const tempo=document.querySelector('#sheet-note-tempo'),bpm=Number(tempo.value);
  if(tempo.value&&(bpm<20||bpm>300||!Number.isFinite(bpm))){tempo.reportValidity();return}
  sheetPushUndo();
  for(const [id,property] of [['sheet-articulation','articulation'],['sheet-dynamic','dynamic'],['sheet-hairpin','hairpin']]){
    const value=document.querySelector('#'+id).value;
    if(value)note[property]=value;
    else delete note[property];
  }
  if(tempo.value)note.tempo=bpm;
  else delete note.tempo;
  renderSheetStaff();
}
function sheetApplyMeasure(){
  const selected=sheetNotes.find(note=>note.id===selectedSheetNoteId);
  if(!selected)return;
  const measureBeats=sheetMeasureBeats(),measure=Math.floor((selected.beat+1e-7)/measureBeats);
  const items=sheetNotes.filter(note=>Math.floor((note.beat+1e-7)/measureBeats)===measure);
  sheetPushUndo();
  for(const note of items)for(const key of ['repeatStart','repeatEnd','ending'])delete note[key];
  if(document.querySelector('#sheet-repeat-start').checked)selected.repeatStart=true;
  if(document.querySelector('#sheet-repeat-end').checked)selected.repeatEnd=true;
  const ending=Number(document.querySelector('#sheet-ending').value);
  if(ending)selected.ending=ending;
  renderSheetStaff();
  document.querySelector('#sheet-status').textContent='Updated measure '+(measure+1)+'.';
}
function sheetDeleteSelected(){
  if(!selectedSheetNoteId)return;sheetPushUndo();sheetNotes=sheetNotes.filter(note=>note.id!==selectedSheetNoteId);
  for(const note of sheetNotes)for(const property of ['tieTo','slurTo'])if(note[property]===selectedSheetNoteId)delete note[property];
  selectedSheetNoteId=null;sheetLinkDraft=null;updateSheetEditButtons();renderSheetStaff();document.querySelector('#sheet-current-note').textContent='Note deleted.';
}
function sheetCopySelected(){
  const note=sheetNotes.find(item=>item.id===selectedSheetNoteId);if(!note)return;
  const {tieTo,slurTo,repeatStart,repeatEnd,ending,...copy}=note;
  copiedSheetNote=sheetClone(copy);updateSheetEditButtons();document.querySelector('#sheet-status').textContent='Note copied. Select Paste to add another.';
}
function sheetPaste(){
  if(!copiedSheetNote)return;sheetPushUndo();const selected=sheetNotes.find(item=>item.id===selectedSheetNoteId),nextBeat=selected?selected.beat+selected.durationBeats:sheetNotes.reduce((max,note)=>Math.max(max,note.beat+note.durationBeats),0),note={...sheetClone(copiedSheetNote),id:'sheet-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),beat:nextBeat};sheetNotes.push(note);selectedSheetNoteId=note.id;updateSheetEditButtons();renderSheetStaff();document.querySelector('#sheet-status').textContent='Note pasted.';
}
function loadSheetProjects(){
  try{const saved=JSON.parse(localStorage.getItem(sheetProjectsStorageKey)||'[]');return Array.isArray(saved)?saved.filter(project=>project&&typeof project.id==='string'&&Array.isArray(project.notes)&&info[project.instrument]).slice(0,50):[]}catch{return []}
}
function saveSheetProjects(projects){
  if(projects.length>50)return false;
  try{localStorage.setItem(sheetProjectsStorageKey,JSON.stringify(projects));return true}catch(error){console.warn('Sheet projects could not be saved in this browser',error);return false}
}
function sheetProjectFromForm(){
  const sourceRecordingId=loadSheetProjects().find(project=>project.id===sheetProjectId)?.sourceRecordingId;
  return {id:sheetProjectId||'sheet-project-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),title:document.querySelector('#sheet-title').value.trim().slice(0,48)||'Untitled song',composer:document.querySelector('#sheet-composer-name').value.trim().slice(0,36),instrument:sheetInstrument(),bpm:Number(document.querySelector('#sheet-tempo').value)||100,clef:sheetClef(),keySignature:document.querySelector('#sheet-key-signature').value,timeSignature:sheetTimeSignature(),notes:sheetClone(sheetNotes),sourceRecordingId,updatedAt:Date.now(),version:1};
}
function saveSheetProject(){
  const project=sheetProjectFromForm(),projects=loadSheetProjects(),index=projects.findIndex(item=>item.id===project.id);if(index>=0)projects[index]=project;else projects.unshift(project);
  if(!saveSheetProjects(projects)){document.querySelector('#sheet-status').textContent='Could not save · browser storage is full or unavailable.';return false}
  sheetProjectId=project.id;renderSheetProjectList();document.querySelector('#sheet-status').textContent='Saved “'+project.title+'” on this device.';return true;
}
function applySheetProject(project){
  stopSheetPlayback();sheetProjectId=project.id;sheetNotes=sheetClone(project.notes);selectedSheetNoteId=null;sheetUndoStack=[];sheetRedoStack=[];
  sheetLinkDraft=null;
  document.querySelector('#sheet-title').value=project.title||'Untitled song';document.querySelector('#sheet-composer-name').value=project.composer||'';document.querySelector('#sheet-instrument').value=info[project.instrument]?project.instrument:'piano';document.querySelector('#sheet-tempo').value=String(Math.max(20,Math.min(300,Number(project.bpm)||100)));document.querySelector('#sheet-tempo-value').textContent=document.querySelector('#sheet-tempo').value+' BPM';document.querySelector('#sheet-clef').value=project.clef==='bass'?'bass':'treble';document.querySelector('#sheet-key-signature').value=sheetKeySignatureCounts[project.keySignature]!==undefined?project.keySignature:'C';document.querySelector('#sheet-place-rest').checked=false;document.querySelector('#sheet-accidental').disabled=false;
  const meter=document.querySelector('#sheet-time-signature');
  const signature=/^(?:[1-9]|1[0-2])\/(?:2|4|8|16)$/.test(project.timeSignature)?project.timeSignature:'4/4';
  if(!Array.from(meter.options).some(option=>option.value===signature))meter.add(new Option(signature,signature));
  meter.value=signature;
  document.querySelector('#sheet-duration').value='1';document.querySelector('#sheet-dots').value='0';document.querySelector('#sheet-triplet').checked=false;
  document.querySelector('#sheet-voice').value='1';document.querySelector('#sheet-chord').checked=false;document.querySelector('#sheet-eraser').checked=false;
  document.querySelector('#sheet-staff').classList.remove('erasing');
  renderSheetStaff();updateSheetEditButtons();document.querySelector('#sheet-status').textContent='Opened “'+project.title+'”.';
}
function sheetExportMusicXML(){
  const status=document.querySelector('#sheet-status');
  try{
    const project=sheetProjectFromForm();
    const xml=SheetMusicXML.exportProject(project);
    const url=URL.createObjectURL(new Blob([xml],{type:'application/vnd.recordare.musicxml+xml'}));
    const link=document.createElement('a');
    link.href=url;link.download=(project.title.replace(/[^\p{L}\p{N}._ -]/gu,'-')||'untitled')+'.musicxml';
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    status.textContent='MusicXML exported.';
  }catch(error){status.textContent=error.message}
}
let sheetImportRequest=0;
async function sheetImportMusicXML(file){
  if(!file)return;
  const request=++sheetImportRequest,status=document.querySelector('#sheet-status');
  try{
    if(file.size>2_000_000)throw new Error('Choose a MusicXML file smaller than 2 MB.');
    const parsed=SheetMusicXML.importProject(await file.text());
    if(request!==sheetImportRequest)return;
    const project={...parsed,id:null};
    applySheetProject(project);
    status.textContent='Imported “'+project.title+'”. Choose Save sheet to save it as a new composition.';
  }catch(error){
    if(request===sheetImportRequest)status.textContent=error.message;
  }
}
function sheetPrint(){
  const layout=sheetStaffGeometry();
  const systems=document.querySelectorAll('#sheet-staff > .sheet-system');
  const scoreMeasures=Math.max(1,...sheetNotes.map(note=>Math.ceil((note.beat+note.durationBeats-1e-7)/layout.measureBeats)));
  const systemLimit=Math.ceil(scoreMeasures/layout.measuresPerSystem);
  document.querySelector('#sheet-print-preview')?.remove();
  const pages=document.createElement('section');
  pages.id='sheet-print-preview';
  for(const system of [...systems].slice(0,systemLimit)){
    const printed=sheetSvgElement('svg',{viewBox:`0 0 ${layout.width} ${layout.height}`,class:'sheet-printed-system'});
    const content=system.cloneNode(true);
    content.removeAttribute('transform');
    printed.append(content);
    pages.append(printed);
  }
  document.body.append(pages);
  window.addEventListener('afterprint',()=>pages.remove(),{once:true});
  window.print();
}
function renderSheetProjectList(){
  const list=document.querySelector('#sheet-project-list');if(!list)return;list.replaceChildren();const projects=loadSheetProjects();
  if(!projects.length){const empty=document.createElement('p');empty.className='composer-empty';empty.textContent='No saved sheets yet. Add notes and choose Save sheet.';list.append(empty);return}
  projects.forEach(project=>{
    const card=document.createElement('article');card.className='composition-card';const details=document.createElement('div'),title=document.createElement('strong'),meta=document.createElement('small'),actions=document.createElement('div');
    title.textContent=project.title;meta.textContent=(project.composer?project.composer+' · ':'')+info[project.instrument].name+' · '+project.bpm+' BPM · '+project.notes.length+' notes · '+project.timeSignature;details.append(title,meta);actions.className='composition-actions';
    const open=document.createElement('button');open.type='button';open.textContent='Open';open.addEventListener('click',()=>applySheetProject(project));
    const duplicate=document.createElement('button');duplicate.type='button';duplicate.textContent='Duplicate';duplicate.addEventListener('click',()=>{const copy=sheetClone(project);copy.id='sheet-project-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);copy.title=(copy.title+' copy').slice(0,48);copy.updatedAt=Date.now();if(saveSheetProjects([copy,...loadSheetProjects()])){renderSheetProjectList();document.querySelector('#sheet-status').textContent='Created a copy of “'+project.title+'”.'}else document.querySelector('#sheet-status').textContent='Could not duplicate · browser storage is unavailable.'});
    const remove=document.createElement('button');remove.type='button';remove.className='composition-delete';remove.textContent='Delete';remove.addEventListener('click',()=>{if(!window.confirm('Delete “'+project.title+'”? This removes the saved sheet from this device.'))return;const remaining=loadSheetProjects().filter(item=>item.id!==project.id);if(saveSheetProjects(remaining)){if(sheetProjectId===project.id)sheetProjectId=null;renderSheetProjectList();document.querySelector('#sheet-status').textContent='Deleted “'+project.title+'”.'}else document.querySelector('#sheet-status').textContent='Could not delete the saved sheet.'});
    actions.append(open,duplicate,remove);card.append(details,actions);list.append(card);
  });
}
const sheetDrumMidiParts={35:'bass',36:'bass',38:'snare',40:'snareSnap',42:'hat',44:'hat',46:'hatOpen',45:'tomLow',47:'tomMid',50:'tomHigh',49:'crash',51:'ride'};
function sheetDrumPartForMidi(midi){
  const choices=Object.keys(sheetDrumMidiParts).map(Number);let nearest=choices[0];for(const choice of choices)if(Math.abs(choice-midi)<Math.abs(nearest-midi))nearest=choice;return sheetDrumMidiParts[nearest];
}
function sheetDrumLabel(part){return ({bass:'Bass drum',snare:'Snare',snareSnap:'Snare snap',hat:'Closed hi-hat',hatOpen:'Open hi-hat',tomLow:'Low tom',tomMid:'Mid tom',tomHigh:'High tom',crash:'Crash cymbal',ride:'Ride cymbal'})[part]||part}
const sheetDrumMidiByPart={bass:36,snare:38,snareSnap:40,hat:42,hatOpen:46,tomLow:45,tomMid:47,tomHigh:50,crash:49,ride:51};
const sheetMidiSpelling=[['C','none'],['C','sharp'],['D','none'],['D','sharp'],['E','none'],['F','none'],['F','sharp'],['G','none'],['G','sharp'],['A','none'],['A','sharp'],['B','none']];
const sheetImportDurations=[.25,.5,1,2,4];
function sheetDurationForRecordedEvent(event,bpm){
  const hasBeats=event.durationBeats!==undefined&&Number.isFinite(Number(event.durationBeats)),beatMs=60000/(Number(bpm)||100),raw=hasBeats?Number(event.durationBeats):(Number(event.duration)>0?Number(event.duration)/beatMs:.7),clamped=Math.max(.25,Math.min(4,Number.isFinite(raw)?raw:.7));
  return sheetImportDurations.reduce((best,value)=>Math.abs(value-clamped)<Math.abs(best-clamped)?value:best,sheetImportDurations[0]);
}
function sheetNoteFromMidi(midi,beat,durationBeats,clef){
  const rounded=Math.max(12,Math.min(119,Math.round(Number(midi)))),pitchClass=((rounded%12)+12)%12,[letter,accidental]=sheetMidiSpelling[pitchClass],octave=Math.floor(rounded/12)-1;
  return {id:'sheet-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),beat:Math.max(0,Math.round(Number(beat)*4)/4),step:sheetStaffStepForPitch(letter,octave,clef),durationBeats,accidental,rest:false};
}
function sheetProjectFromRecording(song){
  const clef=song.instrument==='drums'?'bass':'treble',notes=[];
  song.events.forEach(event=>{
    const beat=Number.isFinite(Number(event.beat))?Number(event.beat):Math.max(0,(Number(event.at)||0)*Number(song.bpm||100)/60000),duration=event.kind==='drum'?.5:sheetDurationForRecordedEvent(event,song.bpm);
    if(event.kind==='drum'){
      const midi=sheetDrumMidiByPart[event.part];if(midi)notes.push(sheetNoteFromMidi(midi,beat,duration,clef));
    }else if(event.kind==='note'&&Number.isFinite(Number(event.midi))){const writtenMidi=Number(event.midi)+(song.instrument==='clarinet'?2:0);notes.push(sheetNoteFromMidi(writtenMidi,beat,duration,clef))}
  });
  return {id:'sheet-from-recording-'+song.id,title:song.title.slice(0,48),composer:'',instrument:song.instrument,bpm:Number(song.bpm)||100,clef,keySignature:'C',timeSignature:'4/4',notes,sourceRecordingId:song.id,updatedAt:Date.now(),version:1};
}
function openRecordingAsSheet(song){
  const projects=loadSheetProjects(),linked=projects.find(project=>project.id==='sheet-from-recording-'+song.id);let project=linked;
  if(!project){project=sheetProjectFromRecording(song);if(!project.notes.length){document.querySelector('#composer-status').textContent='This recording has no readable note events to place on a staff.';return}if(!saveSheetProjects([project,...projects])){document.querySelector('#composer-status').textContent='Could not create a sheet · browser storage is unavailable.';return}}
  applySheetProject(project);openComposerPage(linked?`Opened the sheet linked to “${song.title}”. The saved recording is unchanged.`:`Created an editable sheet from “${song.title}”. The saved recording is unchanged.`);
}
function updateSheetTransport(){
  const active=!!sheetPlaybackSession,playing=active&&!sheetPlaybackSession.paused,preparing=active&&sheetPlaybackSession.preparing;
  document.querySelector('#sheet-play').disabled=playing||preparing;document.querySelector('#sheet-pause').disabled=!playing||preparing;document.querySelector('#sheet-stop').disabled=!active;
}
function stopSheetPlayback(message='Stopped'){
  const session=sheetPlaybackSession;if(session){session.timers.forEach(timer=>clearTimeout(timer));session.timers.clear();session.voices.forEach(voice=>stopVoice(voice,true,.025));session.voices.clear();if(session.frame)cancelAnimationFrame(session.frame)}
  sheetPlaybackSession=null;updateSheetTransport();const output=document.querySelector('#sheet-current-note');if(output)output.textContent=message;
  document.querySelectorAll('#sheet-staff .sheet-note.playing').forEach(note=>note.classList.remove('playing'));
  document.querySelector('#sheet-playhead')?.setAttribute('visibility','hidden');
}
function sheetAnimatePlayhead(session,notes,scoreNotes,time,endBeat){
  const writtenById=new Map(scoreNotes.map(note=>[note.id,note.beat]));
  const layout=sheetStaffGeometry(),measureBeats=layout.measureBeats;
  const performedMeasures=new Map();
  for(const note of notes){
    const written=writtenById.get(note.sourceId),measure=Math.floor((note.beat+1e-7)/measureBeats);
    if(Number.isFinite(written))performedMeasures.set(measure,note.beat-written);
  }
  const measureOrder=[...performedMeasures.keys()];
  let lastRow=-1;
  const draw=()=>{
    if(sheetPlaybackSession!==session||session.paused)return;
    const elapsed=session.elapsedMs+performance.now()-session.startedAt;
    let low=0,high=endBeat;
    for(let index=0;index<20;index++){
      const middle=(low+high)/2;
      if(time(middle)<=elapsed)low=middle;else high=middle;
    }
    const measure=Math.floor((low+1e-7)/measureBeats);
    const mapped=measureOrder.findLast(index=>index<=measure);
    const writtenBeat=Math.max(0,low-(performedMeasures.get(mapped)||0));
    const cursor=document.querySelector('#sheet-playhead'),currentLayout=sheetStaffGeometry();
    if(cursor){
      const x=sheetBeatToX(writtenBeat,currentLayout);
      const row=sheetBeatSystem(writtenBeat,currentLayout),offset=row*currentLayout.height;
      for(const [attr,value] of Object.entries({x1:x,x2:x,y1:offset+currentLayout.top-9,y2:offset+currentLayout.bottom+9,visibility:'visible'}))cursor.setAttribute(attr,value);
      if(row!==lastRow){
        const viewport=document.querySelector('#sheet-staff').parentElement;
        const top=(offset+currentLayout.top-52)*currentLayout.zoom;
        const bottom=(offset+currentLayout.bottom+12)*currentLayout.zoom;
        if(top<viewport.scrollTop||bottom>viewport.scrollTop+viewport.clientHeight){
          viewport.scrollTo?.({top:Math.max(0,top),behavior:'instant'});
        }
        lastRow=row;
      }
    }
    session.frame=requestAnimationFrame(draw);
  };
  session.frame=requestAnimationFrame(draw);
}
function scheduleSheetPlayback(session){
  if(!session||session.paused)return;
  const score=sheetResolveNotes(),measureBeats=sheetMeasureBeats();
  const {notes:resolved,endBeat}=SheetExpression.expandRepeatMeasures(score,measureBeats);
  const time=sheetBuildClock(resolved,Number(document.querySelector('#sheet-tempo').value)||100);
  const gains=sheetBuildGains(resolved,measureBeats);
  const instrument=sheetInstrument();
  session.highlighted=new Set();
  const schedule=(time,callback)=>{
    const delay=Math.max(0,time-session.elapsedMs-performance.now()+session.startedAt);
    const timer=setTimeout(()=>{
      session.timers.delete(timer);
      if(sheetPlaybackSession===session&&!session.paused)callback();
    },delay);
    session.timers.add(timer);
  };
  const findGroup=id=>[...document.querySelectorAll('#sheet-staff .sheet-note')].find(item=>item.dataset.sheetNoteId===id);
  const chains=sheetPlaybackChains(resolved);
  for(const {members,start,end} of chains){
    if(time(end)<=session.elapsedMs)continue;
    const first=members[0];
    const {durationFactor,gainFactor}=SheetExpression.articulationTiming(first.articulation);
    const writtenDuration=time(end)-time(start);
    const gateEnd=members.length>1||first.articulation==='fermata'?time(end):time(start)+writtenDuration*durationFactor;
    let voice=null;
    if(!first.rest&&gateEnd>session.elapsedMs&&(instrument!=='drums'||time(start)>=session.elapsedMs)){
      schedule(time(start),()=>{
        voice=instrument==='drums'?playDrum(sheetDrumPartForMidi(first.midi),false,gains.get(first.id)*gainFactor)
          :playInstrumentNote(instrument,first.midi-(instrument==='clarinet'?2:0),.24*gains.get(first.id)*gainFactor,'Sheet · '+first.label,false);
        if(voice)session.voices.add(voice);
      });
      schedule(gateEnd,()=>{
        if(!voice)return;
        if(instrument!=='drums')stopVoice(voice,false,Math.min(.03,writtenDuration/3000));
        session.voices.delete(voice);
      });
    }
    for(const note of members){
      const id=note.sourceId||note.id;
      const noteEnd=time(note.beat+note.durationBeats);
      if(noteEnd<=session.elapsedMs)continue;
      schedule(time(note.beat),()=>{
        session.highlighted.add(id);
        findGroup(id)?.classList.add('playing');
        const label=instrument==='drums'?sheetDrumLabel(sheetDrumPartForMidi(note.midi)):note.label;
        document.querySelector('#sheet-current-note').textContent=note.rest?`Rest · beat ${note.beat+1}`:`Playing ${label}`;
      });
      schedule(noteEnd,()=>{session.highlighted.delete(id);findGroup(id)?.classList.remove('playing')});
    }
  }
  sheetAnimatePlayhead(session,resolved,score,time,endBeat);
  schedule(time(endBeat)+120,()=>stopSheetPlayback('Playback complete'));
}
function startSheetPlayback({restart=false}={}){
  if(!sheetNotes.length){document.querySelector('#sheet-status').textContent='Add at least one note or rest before playing.';return}
  if(sheetPlaybackSession&&!sheetPlaybackSession.paused&&!restart)return;
  const resumeFrom=restart?0:(sheetPlaybackSession?.elapsedMs||0);
  stopSheetPlayback('Preparing playback…');
  const session={paused:false,preparing:true,startedAt:performance.now(),elapsedMs:resumeFrom,timers:new Set(),voices:new Set()};
  sheetPlaybackSession=session;
  updateSheetTransport();
  void (async()=>{
    try{
      const ready=await ensureAudioReady();
      if(sheetPlaybackSession!==session)return;
      if(!ready){stopSheetPlayback('Audio is unavailable. Press Play sheet to try again.');return}
      await loadInstrument(sheetInstrument());
      if(sheetPlaybackSession!==session)return;
      session.startedAt=performance.now();
      session.preparing=false;
      updateSheetTransport();
      scheduleSheetPlayback(session);
    }catch(error){
      if(sheetPlaybackSession===session)stopSheetPlayback('Unable to start audio: '+error.message);
    }
  })();
}
function pauseSheetPlayback(){
  const session=sheetPlaybackSession;if(!session||session.paused||session.preparing)return;session.elapsedMs+=performance.now()-session.startedAt;session.paused=true;session.timers.forEach(timer=>clearTimeout(timer));session.timers.clear();session.voices.forEach(voice=>stopVoice(voice,true,.025));session.voices.clear();session.highlighted.clear();if(session.frame)cancelAnimationFrame(session.frame);document.querySelectorAll('#sheet-staff .sheet-note.playing').forEach(note=>note.classList.remove('playing'));updateSheetTransport();document.querySelector('#sheet-current-note').textContent='Paused';
}
function sheetNewProject(){stopSheetPlayback('Ready · click the staff to add notes');sheetNotes=[];sheetProjectId=null;selectedSheetNoteId=null;sheetUndoStack=[];sheetRedoStack=[];document.querySelector('#sheet-title').value='My first song';document.querySelector('#sheet-composer-name').value='';document.querySelector('#sheet-instrument').value='piano';document.querySelector('#sheet-clef').value='treble';document.querySelector('#sheet-key-signature').value='C';document.querySelector('#sheet-time-signature').value='4/4';document.querySelector('#sheet-duration').value='1';document.querySelector('#sheet-dots').value='0';document.querySelector('#sheet-accidental').value='none';document.querySelector('#sheet-place-rest').checked=false;document.querySelector('#sheet-accidental').disabled=false;updateSheetEditButtons();renderSheetStaff();document.querySelector('#sheet-status').textContent='New sheet ready.'}
function setupSheetMusicEditor(){
  const svg=document.querySelector('#sheet-staff');
  svg.addEventListener('click',sheetPlaceAt);
  svg.addEventListener('pointermove',sheetHandlePointerMove);
  svg.addEventListener('pointerup',sheetHandlePointerUp);
  for(const type of ['pointercancel','lostpointercapture'])svg.addEventListener(type,event=>{
    if(sheetDragState?.pointerId!==event.pointerId)return;
    sheetDragState=null;sheetPreviewClientPoint=null;updateSheetPreview(null);
  });
  svg.addEventListener('pointerleave',()=>{if(!sheetDragState){sheetPreviewClientPoint=null;updateSheetPreview(null)}});
  ['sheet-title','sheet-composer-name','sheet-key-signature','sheet-time-signature','sheet-note-names'].forEach(id=>document.querySelector('#'+id).addEventListener('input',()=>{
    if(sheetPlaybackSession&&['sheet-key-signature','sheet-time-signature'].includes(id))stopSheetPlayback();
    renderSheetStaff();
    if(id==='sheet-time-signature')updateSheetEditButtons();
  }));
  document.querySelector('#sheet-clef').addEventListener('input',sheetChangeClef);
  document.querySelector('#sheet-zoom').addEventListener('input',event=>{
    document.querySelector('#sheet-zoom-value').textContent=event.target.value+'%';
    renderSheetStaff();
  });
  document.querySelector('#sheet-eraser').addEventListener('change',event=>{
    svg.classList.toggle('erasing',event.target.checked);
    sheetPreviewClientPoint=null;updateSheetPreview(null);
  });
  let viewportWidth=0;
  if(typeof ResizeObserver==='function')new ResizeObserver(entries=>{
    const width=entries[0].contentRect.width;
    if(width>0&&width!==viewportWidth){viewportWidth=width;renderSheetStaff()}
  }).observe(svg.parentElement);
  document.querySelector('#sheet-instrument').addEventListener('change',event=>{if(sheetPlaybackSession)stopSheetPlayback();if(event.target.value==='drums')document.querySelector('#sheet-clef').value='bass';sheetChangeClef()});
  document.querySelector('#sheet-tempo').addEventListener('input',event=>{if(sheetPlaybackSession)stopSheetPlayback();document.querySelector('#sheet-tempo-value').textContent=event.target.value+' BPM'});
  document.querySelector('#sheet-apply-note').addEventListener('click',sheetUpdateSelectedTool);
  document.querySelector('#sheet-apply-expression').addEventListener('click',sheetApplyExpression);
  document.querySelector('#sheet-apply-measure').addEventListener('click',sheetApplyMeasure);
  const importInput=document.querySelector('#sheet-import-file');
  document.querySelector('#sheet-import').addEventListener('click',()=>importInput.click());
  importInput.addEventListener('change',()=>{void sheetImportMusicXML(importInput.files[0]);importInput.value=''});
  document.querySelector('#sheet-export').addEventListener('click',sheetExportMusicXML);
  document.querySelector('#sheet-print').addEventListener('click',sheetPrint);
  document.querySelector('#composer-page').addEventListener('keydown',event=>{
    if(event.target.closest('input,select,textarea,[contenteditable]'))return;
    const key=event.key.toLowerCase();
    if(key==='escape'&&sheetLinkDraft){sheetLinkDraft=null;updateSheetEditButtons()}
    if(event.ctrlKey||event.metaKey){
      if(key==='z'){event.preventDefault();if(event.shiftKey)sheetRedo();else sheetUndo()}
      if(key==='y'){event.preventDefault();sheetRedo()}
    }else if(key==='delete'&&selectedSheetNoteId){event.preventDefault();sheetDeleteSelected()}
  });
  document.querySelector('#sheet-beam').addEventListener('change',event=>{
    const note=sheetNotes.find(note=>note.id===selectedSheetNoteId);if(!note)return;
    sheetPushUndo();note.beamMode=event.target.value;renderSheetStaff();
  });
  for(const mark of ['tie','slur'])document.querySelector('#sheet-'+mark).addEventListener('click',()=>{
    if(selectedSheetNoteId){sheetLinkDraft={id:selectedSheetNoteId,mark};updateSheetEditButtons()}
  });
  document.querySelector('#sheet-remove-links').addEventListener('click',sheetRemoveLinks);
  document.querySelector('#sheet-place-rest').addEventListener('change',event=>document.querySelector('#sheet-accidental').disabled=event.target.checked);
  document.querySelector('#sheet-undo').addEventListener('click',sheetUndo);document.querySelector('#sheet-redo').addEventListener('click',sheetRedo);document.querySelector('#sheet-copy').addEventListener('click',sheetCopySelected);document.querySelector('#sheet-paste').addEventListener('click',sheetPaste);document.querySelector('#sheet-delete-note').addEventListener('click',sheetDeleteSelected);
  document.querySelector('#sheet-play').addEventListener('click',()=>startSheetPlayback());document.querySelector('#sheet-pause').addEventListener('click',pauseSheetPlayback);document.querySelector('#sheet-stop').addEventListener('click',()=>stopSheetPlayback());document.querySelector('#sheet-restart').addEventListener('click',()=>startSheetPlayback({restart:true}));document.querySelector('#sheet-save').addEventListener('click',saveSheetProject);document.querySelector('#sheet-new').addEventListener('click',()=>{
    ++sheetImportRequest;
    sheetLinkDraft=null;
    for(const tool of ['sheet-triplet','sheet-chord','sheet-eraser'])document.querySelector('#'+tool).checked=false;
    svg.classList.remove('erasing');
    document.querySelector('#sheet-voice').value='1';
    sheetNewProject();
  });
  renderSheetStaff();renderSheetProjectList();updateSheetEditButtons();updateSheetTransport();
}
function recordCompositionEvent(instrument,event){if(!composerSession?.recording||composerSession.instrument!==instrument||composerSession.events.length>=250)return null;const elapsed=Math.max(0,performance.now()-composerSession.startedAt),beat=Math.round(elapsed*composerSession.bpm/60000*4)/4,savedEvent={...event,at:Math.round(elapsed),beat,durationBeats:.7};composerSession.events.push(savedEvent);const count=composerSession.events.length;document.querySelector('#composer-toolbar-copy').textContent=`Recording “${composerSession.title}” · ${count} notes · ${Math.floor(elapsed/1000)}s`;return savedEvent}
function stopComposerPlayback(){for(const timer of composerPlaybackTimers)window.clearTimeout(timer);composerPlaybackTimers.clear();if(composerSession?.playing){composerSession.playing=false;composerSession=null;document.querySelector('#composer-toolbar').classList.add('hidden')}}
function showComposerToolbar(session){const toolbar=document.querySelector('#composer-toolbar'),save=document.querySelector('#composer-save'),cancel=document.querySelector('#composer-cancel');toolbar.classList.remove('hidden');if(session.recording){document.querySelector('#composer-toolbar-copy').textContent=`Recording “${session.title}” · 0 notes`;save.classList.remove('hidden');save.textContent='Save song';cancel.textContent='Cancel'}else{document.querySelector('#composer-toolbar-copy').textContent=`Playing “${session.title}”`;save.classList.add('hidden');cancel.textContent='Stop replay'}}
function renderComposerPage(message=''){const list=document.querySelector('#composer-song-list');list.replaceChildren();document.querySelector('#composer-status').textContent=message||'Songs are saved on this device.';renderSheetProjectList();renderSheetStaff();const songs=loadCompositions();if(!songs.length){const empty=document.createElement('p');empty.className='composer-empty';empty.textContent='No saved recordings yet. Record your first one above.';list.append(empty);return}songs.forEach(song=>{const card=document.createElement('article');card.className='composition-card';const details=document.createElement('div'),title=document.createElement('strong'),meta=document.createElement('small'),actions=document.createElement('div');title.textContent=song.title;meta.textContent=`${info[song.instrument].name} · ${song.bpm} BPM · ${song.events.length} notes`;details.append(title,meta);actions.className='composition-actions';const play=document.createElement('button');play.type='button';play.className='composition-play';play.textContent='▶ Play';play.addEventListener('click',()=>playSavedComposition(song.id));const toSheet=document.createElement('button');toSheet.type='button';toSheet.textContent='Open as sheet';toSheet.title='Convert this saved performance into editable notation';toSheet.addEventListener('click',()=>openRecordingAsSheet(song));const remove=document.createElement('button');remove.type='button';remove.className='composition-delete';remove.textContent='Delete';remove.addEventListener('click',()=>{saveCompositions(loadCompositions().filter(item=>item.id!==song.id));renderComposerPage('Song deleted.')});actions.append(play,toSheet,remove);card.append(details,actions);list.append(card)})}
function openComposerPage(message=''){stopRhythmGame('');stopPlayback();appFlow='composer';player.classList.add('hidden');player.classList.remove('rhythm-playing');chooser.classList.add('hidden');welcome.classList.add('hidden');hideHomeSubpages();document.querySelector('#composer-page').classList.remove('hidden');setPrimaryTab('composer');renderComposerPage(message);window.scrollTo({top:0,behavior:'smooth'})}
function startCompositionRecording(){const instrument=document.querySelector('#composer-instrument').value,title=document.querySelector('#composer-title').value.trim().slice(0,32)||'My song',bpm=Number(document.querySelector('#composer-tempo').value)||100;appFlow='composer-recording';choose(instrument);composerSession={recording:true,title,instrument,bpm,startedAt:performance.now(),events:[]};showComposerToolbar(composerSession)}
function saveCompositionRecording(){const session=composerSession;if(!session?.recording)return;if(!session.events.length){document.querySelector('#composer-toolbar-copy').textContent='Play at least one note before saving.';return}session.recording=false;stopPlayback();const song={id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`,title:session.title,instrument:session.instrument,bpm:session.bpm,createdAt:todayStamp(),events:session.events.slice().sort((a,b)=>a.at-b.at)};const saved=saveCompositions([song,...loadCompositions()]);composerSession=null;openComposerPage(saved?`“${song.title}” saved · ${song.events.length} notes.`:'Could not save; check available browser storage.')}
function cancelComposition(){composerSession=null;stopPlayback();openComposerPage('Recording or playback canceled.')}
async function playSavedComposition(id){const song=loadCompositions().find(item=>item.id===id);if(!song)return;appFlow='free';choose(song.instrument);const session={playing:true,title:song.title,instrument:song.instrument};composerSession=session;showComposerToolbar(session);await ensureAudioReady();await loadInstrument(song.instrument);if(composerSession!==session||!session.playing)return;const noteMs=60000/song.bpm,delayFor=event=>Number.isFinite(Number(event.beat))?Number(event.beat)*noteMs:Number(event.at)||0,durationFor=event=>Number.isFinite(Number(event.durationBeats))?Math.max(80,Number(event.durationBeats)*noteMs):Math.max(220,Number(event.duration)||420),durationMs=song.events.reduce((max,event)=>Math.max(max,delayFor(event)+(event.kind==='note'?durationFor(event):0)),0);song.events.forEach(event=>{const timer=window.setTimeout(()=>{composerPlaybackTimers.delete(timer);if(composerSession!==session||!session.playing)return;const voice=event.kind==='drum'?playDrum(event.part,false):playInstrumentNote(song.instrument,Number(event.midi),.24,'Song Creator replay',false);if(event.kind==='note'&&voice){const releaseTimer=window.setTimeout(()=>{composerPlaybackTimers.delete(releaseTimer);stopVoice(voice,false,.07)},durationFor(event));composerPlaybackTimers.add(releaseTimer)}},Math.max(0,delayFor(event)));composerPlaybackTimers.add(timer)});const endTimer=window.setTimeout(()=>{composerPlaybackTimers.delete(endTimer);if(composerSession!==session)return;stopPlayback();openComposerPage(`Replay finished · “${song.title}”.`)},durationMs+500);composerPlaybackTimers.add(endTimer)}
function startDailyChallenge(){const challenge=ensureDailyChallenge();if(challenge.completed)return;appFlow='daily-challenge';choose(challenge.instrument)}
function openDailyChallengePage(){stopRhythmGame('');stopPlayback();appFlow='daily-page';player.classList.add('hidden');player.classList.remove('rhythm-playing');chooser.classList.add('hidden');welcome.classList.add('hidden');hideHomeSubpages();document.querySelector('#daily-challenge-page').classList.remove('hidden');setPrimaryTab('');renderDailyChallenge();window.scrollTo({top:0,behavior:'smooth'})}
function applyLastInstrumentPreference(){document.querySelectorAll('.instrument-card').forEach(card=>card.classList.toggle('last-used',card.dataset.instrument===playerProgress.settings.lastInstrument))}
function renderInstrumentSwitcher(currentId){const nav=document.querySelector('#instrument-switcher');nav.replaceChildren();Object.entries(info).forEach(([id,item])=>{const button=document.createElement('button');button.type='button';button.className=`instrument-switch-tab${id===currentId?' selected':''}`;button.setAttribute('aria-pressed',String(id===currentId));button.setAttribute('aria-label',`Switch to ${item.name}`);const icon=document.createElement('span');icon.textContent=item.icon;const name=document.createElement('span');name.textContent=item.name;button.append(icon,name);button.addEventListener('click',()=>choose(id));nav.append(button)})}
function setPrimaryTab(active){document.querySelectorAll('[data-topnav]').forEach(button=>{const selected=button.dataset.topnav===active;button.classList.toggle('selected',selected);if(selected)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current')})}
function hideHomeSubpages(){document.querySelectorAll('.home-page').forEach(page=>page.classList.add('hidden'))}
function openPlayModesPage(){stopRhythmGame('');stopPlayback();player.classList.add('hidden');player.classList.remove('rhythm-playing');player.removeAttribute('data-instrument');chooser.classList.add('hidden');welcome.classList.add('hidden');hideHomeSubpages();document.querySelector('#play-modes-page').classList.remove('hidden')}
function renderRhythmSongs(){
  const list=document.querySelector('#rhythm-songs-list');list.replaceChildren();selectedRhythmSongId=null;selectedSong=null;availableRhythmSongs().forEach(song=>{const card=document.createElement('button');card.type='button';card.className=`rhythm-song-card${song.sheetNotes?' custom-sheet-song':''}`;const title=document.createElement('strong'),meta=document.createElement('span'),length=document.createElement('span'),best=document.createElement('small'),action=document.createElement('span');title.textContent=song.name;meta.textContent=`${song.bpm} BPM · ${song.difficulty}`;length.textContent=`${niceLength(song)} · ${song.sheetNotes?'saved sheet composition':'original practice melody'}`;const scores=Object.entries(playerProgress.bestScores).filter(([key])=>key.endsWith(`:${song.id}`)).map(([,score])=>Number(score)||0);best.textContent=`Best score ${Math.max(0,...scores).toLocaleString()} · ${'★'.repeat(playerProgress.songStars[song.id]||0)}${'☆'.repeat(3-(playerProgress.songStars[song.id]||0))}`;action.className='rhythm-card-action';action.textContent='Choose song →';card.append(title,meta,length,best,action);card.addEventListener('click',()=>{selectedRhythmSongId=song.id;selectedSong=song;openInstrumentChooser('rhythm-picked')});list.append(card)})
}
function openSongSelectionPage(){
  if(composerSession?.recording){composerSession=null;document.querySelector('#composer-toolbar').classList.add('hidden')}stopRhythmGame('');stopPlayback();appFlow='rhythm';player.classList.add('hidden');player.classList.remove('rhythm-playing');chooser.classList.add('hidden');welcome.classList.add('hidden');hideHomeSubpages();document.querySelector('#rhythm-songs-page').classList.remove('hidden');setPrimaryTab('rhythm');
  document.querySelector('#rhythm-eyebrow').textContent='RHYTHM MODE';document.querySelector('#rhythm-songs-title').textContent='Choose a song';document.querySelector('#rhythm-songs-help').textContent='Choose a practice song, then pick an instrument for the rhythm game.';renderRhythmSongs();window.scrollTo({top:0,behavior:'smooth'});
}
function openRhythmPage(){openSongSelectionPage()}
function openLevelsPage(){if(composerSession?.recording){composerSession=null;document.querySelector('#composer-toolbar').classList.add('hidden')}stopRhythmGame('');stopPlayback();appFlow='level';selectedLevelNumber=null;selectedSong=null;player.classList.add('hidden');player.classList.remove('rhythm-playing');chooser.classList.add('hidden');welcome.classList.add('hidden');hideHomeSubpages();document.querySelector('#levels-page').classList.remove('hidden');renderLevels();setPrimaryTab('levels');window.scrollTo({top:0,behavior:'smooth'})}
function handleChooserBack(){if(appFlow==='rhythm-picked'){openRhythmPage();return}if(appFlow==='level'){openLevelsPage();return}showMainMenu()}
function showMainMenu(){if(composerSession?.recording){composerSession=null;document.querySelector('#composer-toolbar').classList.add('hidden')}stopRhythmGame('');stopPlayback();appFlow='free';selectedLevelNumber=null;selectedRhythmSongId=null;selectedSong=null;player.classList.add('hidden');player.classList.remove('rhythm-playing');player.removeAttribute('data-instrument');welcome.classList.add('hidden');hideHomeSubpages();document.querySelector('#song-picker').classList.add('hidden');rhythmPanel.classList.add('hidden');document.querySelector('#results-panel').classList.add('hidden');document.querySelector('#stage').classList.remove('rhythm-active');chooser.classList.remove('hidden');document.querySelector('#chooser-back').hidden=true;setPrimaryTab('play');window.scrollTo({top:0,behavior:'smooth'})}
function rhythmSongFromSheetProject(project){
  const sheetNotes=sheetResolveNotes(project.notes,{clef:project.clef,keySignature:project.keySignature,timeSignature:project.timeSignature});
  return {id:'sheet:'+project.id,sheetProjectId:project.id,sheetInstrument:project.instrument,name:project.title,bpm:Number(project.bpm)||100,difficulty:'Custom',step:.25,pattern:[],chords:[],description:`Your sheet · ${info[project.instrument]?.name||'instrument'} · ${sheetNotes.filter(note=>!note.rest).length} playable notes`,sheetNotes};
}
function rhythmSongForId(id){
  if(typeof id==='string'&&id.startsWith('sheet:')){const project=loadSheetProjects().find(item=>`sheet:${item.id}`===id);return project?rhythmSongFromSheetProject(project):null}
  return musicLibrary.find(song=>song.id===id)||null;
}
function availableRhythmSongs(){
  return [...musicLibrary,...loadSheetProjects().map(rhythmSongFromSheetProject).filter(song=>song.sheetNotes.some(note=>!note.rest))];
}
function openInstrumentChooser(flow='free'){
  stopRhythmGame('');stopPlayback();appFlow=flow;welcome.classList.add('hidden');hideHomeSubpages();player.classList.add('hidden');player.classList.remove('rhythm-playing');document.querySelector('#song-picker').classList.add('hidden');rhythmPanel.classList.add('hidden');document.querySelector('#results-panel').classList.add('hidden');chooser.classList.remove('hidden');
  const context=document.querySelector('#chooser-context'),copy=document.querySelector('#chooser-copy'),back=document.querySelector('#chooser-back');
  if(flow==='free'){context.textContent='FREE PLAY';copy.textContent='Choose an instrument and play immediately.';back.hidden=true;setPrimaryTab('play')}
  else if(flow==='rhythm-picked'){context.textContent='RHYTHM MODE · CHOOSE AN INSTRUMENT';copy.textContent='Your song is selected. Choose an instrument, then play the notes in time.';back.textContent='← Back to songs';back.hidden=false;setPrimaryTab('rhythm')}
  else if(flow==='level'){context.textContent=`LEVEL ${selectedLevelNumber||''} · CHOOSE AN INSTRUMENT`;copy.textContent='Choose an instrument to play this level.';back.textContent='← Back to levels';back.hidden=false;setPrimaryTab('levels')}
  else{context.textContent='CHOOSE AN INSTRUMENT';copy.textContent='Pick an instrument to continue to song selection.';back.textContent='← Back';back.hidden=false}
  window.scrollTo({top:0,behavior:'smooth'});
}
function openSongPicker(){
  const picker=document.querySelector('#song-picker');player.classList.remove('rhythm-playing');player.classList.toggle('rhythm-setup',['rhythm-picked','level'].includes(appFlow));rhythmPanel.classList.add('hidden');document.querySelector('#results-panel').classList.add('hidden');picker.classList.remove('hidden');document.querySelector('#stage').classList.add('rhythm-active');buildSongPicker();window.scrollTo({top:0,behavior:'smooth'});
}
function choose(id){
  const current=info[id];if(!current)return;if(composerSession?.recording){composerSession=null;document.querySelector('#composer-toolbar').classList.add('hidden')}if(id==='guitar')selectedGuitarFrets.clear();if(id==='violin')selectedViolinNotes.clear();const previous=player.dataset.instrument;if(previous&&previous!==id)delete pendingNotes[previous];if(id!=='drums')pendingDrums.length=0;stopRhythmGame('');stopPlayback();void ensureAudioReady();playerProgress.settings.lastInstrument=id;savePlayerProgress();applyLastInstrumentPreference();chooser.classList.add('hidden');welcome.classList.add('hidden');hideHomeSubpages();player.classList.remove('hidden','rhythm-setup');player.classList.toggle('advanced-mode',!!playerProgress.settings.advancedMode);player.dataset.instrument=id;refreshKeyboardFeedback();document.querySelector('#instrument-title').textContent=current.name;document.querySelector('#instrument-icon').textContent=current.icon;document.querySelector('#instrument-icon').style.background=colors[id];document.querySelector('#sound-caption').textContent='Loading instrument samples…';document.querySelector('#note-info').textContent='Choose a control to see its note and fingering.';art.className=`instrument-art ${id}-art instrument-fade-in`;art.replaceChildren();controls.replaceChildren();renderInstrumentSwitcher(id);
  const firstTip=document.querySelector('#first-play-tutorial');firstTip.classList.toggle('hidden',!!playerProgress.settings.tutorialSeen||appFlow!=='free');
  const challengeBanner=document.querySelector('#daily-challenge-banner'),challenge=appFlow==='daily-challenge'?ensureDailyChallenge():null;challengeBanner.classList.toggle('hidden',!challenge);if(challenge){document.querySelector('#daily-challenge-banner-copy').textContent=challenge.completed?'Challenge complete · +100 Music Points':`Daily challenge · ${challenge.progress}/${challenge.goal} notes · play ${info[challenge.instrument].name}`;const progress=document.querySelector('#daily-challenge-banner-progress');progress.max=challenge.goal;progress.value=challenge.progress}document.querySelector('#composer-toolbar').classList.add('hidden');player.classList.remove('rhythm-playing');document.querySelector('#song-picker').classList.add('hidden');rhythmPanel.classList.add('hidden');document.querySelector('#results-panel').classList.add('hidden');document.querySelector('#stage').classList.remove('rhythm-active');if(id==='drums')buildDrums();else if(id==='piano')buildPiano();else if(current.kind==='strings')buildStrings(id);else buildWind(id);loadInstrument(id);document.querySelector('#stage').scrollTop=0;document.querySelector('#stage').scrollLeft=0;window.scrollTo({top:0,behavior:'auto'});
  if(['rhythm-picked','level'].includes(appFlow))openSongPicker();
}
function recordInstrumentSelection(id){if(!playerProgress.stats.instrumentsUsed.includes(id))playerProgress.stats.instrumentsUsed.push(id);savePlayerProgress();if(playerProgress.stats.instrumentsUsed.length>=5)unlockAchievement('instrument-explorer')}
function leaveInstrument(){if(composerSession?.recording){composerSession=null;document.querySelector('#composer-toolbar').classList.add('hidden')}stopRhythmGame('');stopPlayback();player.classList.add('hidden');player.classList.remove('rhythm-playing');player.removeAttribute('data-instrument');document.querySelector('#song-picker').classList.add('hidden');rhythmPanel.classList.add('hidden');document.querySelector('#results-panel').classList.add('hidden');document.querySelector('#stage').classList.remove('rhythm-active');if(appFlow==='daily-challenge'){openDailyChallengePage();return}if(appFlow==='composer-recording'){openComposerPage('Recording canceled.');return}if(appFlow==='free'){chooser.classList.remove('hidden');welcome.classList.add('hidden')}else openInstrumentChooser(appFlow);window.scrollTo({top:0,behavior:'smooth'})}
function buildSongPicker(){
  const picker=document.querySelector('#song-picker'),list=document.querySelector('#song-list'),start=document.querySelector('#song-start'),instrument=player.dataset.instrument,previousSongId=appFlow==='level'?null:selectedSong?.id;picker.classList.toggle('preselected-rhythm',appFlow==='rhythm-picked'||appFlow==='level');list.replaceChildren();start.disabled=true;selectedSong=null;
  const songContext=document.querySelector('#song-context'),title=document.querySelector('#song-picker-title'),label=document.querySelector('#song-instrument-label');document.querySelector('#practice-tempo-picker').value=String(playerProgress.settings.practiceTempo||100);document.querySelector('#practice-tempo-value').textContent=`${playerProgress.settings.practiceTempo||100}%`;document.querySelector('#metronome-picker').checked=!!playerProgress.settings.metronomeEnabled;document.querySelector('#rhythm-difficulty').value=playerProgress.settings.rhythmDifficulty==='advanced'?'advanced':'easy';
  if(appFlow==='level'&&selectedLevelNumber){const level=levelCatalog[selectedLevelNumber-1],base=musicLibrary.find(song=>song.id===level.song);songContext.textContent=`LEVEL ${selectedLevelNumber} · TARGET ${level.target.toLocaleString()}`;title.textContent=`${base.name} · ${level.difficulty}`;selectedSong={...base,bpm:level.bpm,level:selectedLevelNumber,target:level.target};}
  else if(appFlow==='rhythm-picked'&&selectedRhythmSongId){selectedSong=rhythmSongForId(selectedRhythmSongId);songContext.textContent='RHYTHM MODE';title.textContent=selectedSong?.name||'Choose a song'}
  else{songContext.textContent='RHYTHM MODE';title.textContent='Choose a song';selectedSong=rhythmSongForId(previousSongId)}
  label.textContent=`Playing ${info[instrument]?.name||'instrument'}${instrument==='clarinet'?' · use combined clarinet fingering keys':''}`;
  const songs=(appFlow==='level'&&selectedLevelNumber)||appFlow==='rhythm-picked'?[selectedSong]:availableRhythmSongs();
  songs.forEach(song=>{if(!song)return;const isSelected=selectedSong?.id===song.id;const card=document.createElement('button');card.type='button';card.className=`song-card${isSelected?' selected':''}`;const name=document.createElement('strong'),meta=document.createElement('span'),description=document.createElement('span'),record=document.createElement('span');name.textContent=song.name;meta.textContent=`${song.bpm} BPM · ${song.difficulty} · ${niceLength(song)}`;description.textContent=song.description;const key=`${instrument}:${song.id}`;record.textContent=`Best ${Number(playerProgress.bestScores[key]||0).toLocaleString()} · ${'★'.repeat(playerProgress.songStars[song.id]||0)}${'☆'.repeat(3-(playerProgress.songStars[song.id]||0))}`;card.append(name,meta,description,record);card.addEventListener('click',()=>{selectedSong=song;list.querySelectorAll('.song-card').forEach(item=>item.classList.toggle('selected',item===card));start.disabled=false});list.append(card)});
  if(selectedSong)start.disabled=false;
}
function visiblePlayableNotes(instrument){
  if(instrument==='piano')return notes.piano.map(row=>row[2]);if(instrument==='guitar')return notes.guitar.flatMap(([,base])=>Array.from({length:25},(_,fret)=>Math.round(69+12*Math.log2(base/440))+fret));if(instrument==='violin')return notes.violin.flatMap(([,base])=>{const root=Math.round(69+12*Math.log2(base/440));return [root,...violinPositionStarts.flatMap(start=>violinFingerOffsets.map(offset=>root+start+offset))]});if(instrument==='flute')return notes.flute.map(row=>row[1]);if(instrument==='clarinet')return notes.clarinet.map(row=>row[1]-2);return [];
}
function rhythmSheetMidi(song,note){return Number(note.midi)-(song.sheetInstrument==='clarinet'?2:0)}
function rhythmSheetDrumPart(song,note,index){
  if(song.sheetInstrument==='drums')return sheetDrumPartForMidi(note.midi);
  return ({C:'bass',D:'snare',E:'hat',F:'tomHigh',G:'tomMid',A:'tomLow',B:'crash'})[note.letter]||(['bass','snare','hat','tomHigh','tomMid','tomLow','crash','ride'][index%8]);
}
function lanePitches(instrument,song=null){
  if(song?.sheetNotes){const played=song.sheetNotes.filter(note=>!note.rest);if(instrument==='drums'){const parts=[...new Set(played.map((note,index)=>rhythmSheetDrumPart(song,note,index)))];return parts.map(part=>({part,label:part==='hat'?'Hi-hat':part==='hatOpen'?'Open hat':part==='snareSnap'?'Snare snap':part.replace(/([A-Z])/g,' $1').replace(/^./,letter=>letter.toUpperCase())}))}return [...new Set(played.map(note=>rhythmSheetMidi(song,note)))].sort((a,b)=>a-b)}
  if(instrument==='drums')return Object.entries(drumUrls).map(([part])=>({part,label:part==='hat'?'Hi-hat':part==='hatOpen'?'Open hat':part==='snareSnap'?'Snare snap':part.replace(/([A-Z])/g,' $1').replace(/^./,letter=>letter.toUpperCase())}));const preferred=rhythmPitchLanes[instrument]||[];const supported=new Set(visiblePlayableNotes(instrument));const lanes=preferred.filter(midi=>supported.has(midi));return lanes.length>=3?lanes:preferred
}
const rhythmWindowsFor=difficulty=>difficulty==='advanced'?{perfect:35,great:68,good:105}:{perfect:65,great:125,good:220};
function updateRhythmStats(){
  if(!rhythmState)return;const state=rhythmState;document.querySelector('#game-score').textContent=String(state.score);document.querySelector('#game-combo').textContent=String(state.combo);document.querySelector('#game-highest').textContent=String(state.highestCombo);document.querySelector('#game-perfect').textContent=String(state.perfect);document.querySelector('#game-great').textContent=String(state.great);document.querySelector('#game-good').textContent=String(state.good);document.querySelector('#game-misses').textContent=String(state.misses);document.querySelector('#game-accuracy').textContent=state.judged?`${Math.round(state.hits/state.judged*100)}%`:'—';
}
function rhythmInputKey(event){
  const state=rhythmState;if(!state||state.pausedAt!==null||event.type!=='keydown'||event.repeat||event.ctrlKey||event.altKey||event.metaKey||event.code!=='Space'||isTypingTarget(event.target))return;if(event.target instanceof Element&&event.target.closest('button'))return;event.preventDefault();toggleRhythmPause();
}
function startRhythmGame(){
  if(!selectedSong){document.querySelector('#game-feedback').textContent='Choose a song first';return}stopRhythmGame('');stopPlayback();player.classList.remove('rhythm-setup');const instrument=player.dataset.instrument;if(!instrument){document.querySelector('#game-feedback').textContent='Choose an instrument first';return}const song=selectedSong,startButton=document.querySelector('#song-start');startButton.disabled=true;startButton.textContent='Starting…';document.querySelector('#sound-caption').textContent='Starting audio…';void loadInstrument(instrument).catch(error=>{console.warn('Instrument samples failed; built-in tones remain available',error);document.querySelector('#sound-caption').textContent=`Built-in ${instrument} sound active`});void ensureAudioReady().then(audioReady=>{if(!audioReady)setAudioStatus('error','Audio unavailable · check browser audio permissions')});const tempo=Math.max(50,Math.min(150,Number(playerProgress.settings.practiceTempo)||100)),effectiveBpm=song.bpm*tempo/100,lanes=lanePitches(instrument,song),events=[];let ordinal=0;
  if(song.sheetNotes){const usedBeats=new Set();song.sheetNotes.filter(note=>!note.rest).forEach((note,index)=>{const beat=Math.max(0,Number(note.beat)||0);if((monophonicInstruments.has(instrument)||instrument==='drums')&&usedBeats.has(beat))return;usedBeats.add(beat);const target=instrument==='drums'?rhythmSheetDrumPart(song,note,index):rhythmSheetMidi(song,note),lane=instrument==='drums'?lanes.findIndex(item=>item.part===target):lanes.indexOf(target);if(lane>=0)events.push({id:ordinal++,lane,beat,judged:false,el:null})})}
  else{const sequence=instrument==='drums'?drumSongCharts[song.id]:song.pattern;sequence.forEach((value,index)=>{if(value===null)return;const degrees=Array.isArray(value)?value:[value];(monophonicInstruments.has(instrument)||instrument==='drums'?degrees.slice(0,1):degrees).forEach(degree=>events.push({id:ordinal++,lane:instrument==='drums'?degree:((degree%lanes.length)+lanes.length)%lanes.length,beat:index*song.step,judged:false,el:null}))})}
  const totalBeats=rhythmSongTotalBeats(song),backingEvents=[];if(!song.sheetNotes&&instrument==='drums'){for(let beat=0;beat<totalBeats;beat++)backingEvents.push({beat,parts:beat%4===0?['hat','bass']:beat%4===2?['hat','snare']:['hat'],played:false})}else if(!song.sheetNotes&&instrument!=='drums')for(let beat=0;beat<totalBeats;beat+=4)backingEvents.push({beat,root:song.chords[Math.floor(beat/4)%song.chords.length],played:false});
  const difficulty=playerProgress.settings.rhythmDifficulty==='advanced'?'advanced':'easy',hitWindows=rhythmWindowsFor(difficulty),startAt=performance.now()+3100;rhythmState={instrument,lanes,events,backingEvents,totalBeats,startAt,leadInMs:900,pausedAt:null,score:0,combo:0,highestCombo:0,perfect:0,great:0,good:0,hits:0,misses:0,judged:0,bpm:effectiveBpm,stepBeats:song.sheetNotes?.length ? .25 : song.step,difficulty,hitWindows,metronomeEnabled:!!playerProgress.settings.metronomeEnabled,metronomeBeat:-1};document.querySelector('#game-great').textContent='0';
  document.querySelector('#game-song-title').textContent=song.name;document.querySelector('#game-tempo').textContent=`${Math.round(effectiveBpm)} BPM${tempo!==100?` · ${tempo}% practice tempo`:''}${rhythmState.metronomeEnabled?' · metronome on':''} · ${song.difficulty}`;document.querySelector('#game-score').textContent='0';document.querySelector('#game-combo').textContent='0';document.querySelector('#game-highest').textContent='0';document.querySelector('#game-perfect').textContent='0';document.querySelector('#game-good').textContent='0';document.querySelector('#game-misses').textContent='0';document.querySelector('#game-accuracy').textContent='—';document.querySelector('#game-feedback').textContent='Get ready';document.querySelector('#game-target').textContent=song.level?`Target ${song.target.toLocaleString()}`:'';document.querySelector('#game-pause').textContent='Pause';document.querySelector('#song-progress').value=0;document.querySelector('#progress-label').textContent='0%';document.querySelector('#countdown-overlay').classList.remove('hidden');
  const track=document.querySelector('#note-track'),laneBox=document.querySelector('#game-lanes');track.style.setProperty('--lanes',lanes.length);laneBox.style.setProperty('--lanes',lanes.length);track.querySelectorAll('.falling-note').forEach(el=>el.remove());laneBox.replaceChildren();
  lanes.forEach((lane,index)=>{const button=document.createElement('button');button.type='button';button.className=`game-lane${instrument==='clarinet'?' reference-lane':''}`;button.textContent=instrument==='drums'?lane.label:instrument==='clarinet'?pitchName(lane+2):pitchName(lane);button.setAttribute('aria-label',instrument==='clarinet'?`Play clarinet written ${pitchName(lane+2)}, concert ${pitchName(lane)}`:instrument==='drums'?`Play ${lane.label}`:`Play ${pitchName(lane)}`);if(instrument==='clarinet')button.title=`Written ${pitchName(lane+2)} · concert ${pitchName(lane)}`;wirePlay(button,()=>instrument==='drums'?playDrum(lane.part):playInstrumentNote(instrument,lane,.24,'Rhythm lane'));laneBox.append(button)});
  const keyboardHint={piano:'Piano: use the labeled computer keys or click/tap a lane.',guitar:'Guitar: A S D F G H play strings low to high at the selected fret; click/tap a lane.',drums:'Drums: A S D F G H J K L ; play the labeled drum parts.',violin:'Violin: Q W E R choose strings; hold 1–4 with a string key for finger positions.',flute:'Flute: C–B play notes; W changes octave; click/tap a lane.',clarinet:'Clarinet: use the physical fingering or C–B keys; you can also click/tap the C–B lanes.'};document.querySelector('#game-key-hint').textContent=`${keyboardHint[instrument]} Space pauses · ${difficulty==='easy'?'Easy timing window':'Advanced timing window'}`;
  startButton.disabled=false;startButton.textContent='Start song';document.querySelector('#song-picker').classList.add('hidden');player.classList.add('rhythm-playing');rhythmPanel.classList.remove('hidden');document.querySelector('#results-panel').classList.add('hidden');document.querySelector('#stage').classList.add('rhythm-active');
  events.forEach(event=>{const note=document.createElement('span');note.className=`falling-note${instrument==='drums'?' drum-note':''}`;note.style.left=`${(event.lane+.5)*100/lanes.length}%`;note.setAttribute('aria-hidden','true');event.el=note;track.append(note)});window.scrollTo({top:0,behavior:'smooth'});rhythmRaf=requestAnimationFrame(renderRhythmFrame);
}
function launchRhythmGame(){try{startRhythmGame()}catch(error){console.error('The rhythm song could not start',error);stopRhythmGame('Could not start · try again');player.classList.remove('rhythm-playing');rhythmPanel.classList.add('hidden');document.querySelector('#song-picker').classList.remove('hidden');const button=document.querySelector('#song-start');button.textContent='Start song';button.disabled=!selectedSong;document.querySelector('#sound-caption').textContent='Could not start song · tap Start song to retry';setAudioStatus('error','Game could not start')}}
function renderRhythmFrame(now){
  if(!rhythmState)return;try{const state=rhythmState,elapsed=now-state.startAt,track=document.querySelector('#note-track'),height=track.clientHeight,hitY=height-27,approach=1900,secondsPerBeat=60/state.bpm,totalBeats=state.totalBeats,songDuration=totalBeats*secondsPerBeat*1000,leadInMs=state.leadInMs||0,overlay=document.querySelector('#countdown-overlay');
  if(elapsed<0){const remaining=-elapsed;overlay.textContent=remaining>2000?'3':remaining>1000?'2':'1';overlay.classList.remove('hidden')}else if(elapsed<500){overlay.textContent='GO';overlay.classList.remove('hidden')}else overlay.classList.add('hidden');
  if(state.metronomeEnabled&&elapsed>=leadInMs){const beat=Math.floor((elapsed-leadInMs)/(secondsPerBeat*1000));if(beat>state.metronomeBeat){state.metronomeBeat=beat;playMetronomeClick(beat%4===0)}}
  for(const backing of state.backingEvents)if(!backing.played&&elapsed>=leadInMs+backing.beat*secondsPerBeat*1000){backing.played=true;playSongBacking(state,backing)}
  for(const event of state.events){if(event.judged)continue;const hitAt=leadInMs+event.beat*secondsPerBeat*1000;if(elapsed>hitAt+state.hitWindows.good){event.judged=true;event.el?.remove();state.misses++;state.combo=0;state.judged++;document.querySelector('#game-feedback').textContent='Miss';updateRhythmStats();continue}const y=hitY-((hitAt-elapsed)/approach)*hitY;event.el.style.top=`${Math.max(-20,Math.min(height+20,y))}px`;event.el.style.opacity=(y< -10||y>height+10)?'0':'1';event.el.classList.toggle('near-hit',Math.abs(hitAt-elapsed)<state.hitWindows.great)}
  const progress=Math.max(0,Math.min(100,(elapsed-leadInMs)/songDuration*100));document.querySelector('#song-progress').value=progress;document.querySelector('#progress-label').textContent=`${Math.round(progress)}%`;if(elapsed>leadInMs+songDuration+250){finishRhythmGame('Song complete');return}rhythmRaf=requestAnimationFrame(renderRhythmFrame)}catch(error){console.error('Rhythm game frame failed',error);document.querySelector('#countdown-overlay').classList.add('hidden');stopRhythmGame('Game paused · restart to continue')}
}
function judgeRhythmInput(instrument,midi,drumPart=null){
  const state=rhythmState;if(!state||state.instrument!==instrument||state.pausedAt!==null)return;const elapsed=performance.now()-state.startAt-(state.leadInMs||0),beatMs=60000/state.bpm,windowMs=state.hitWindows.good;const unresolved=state.events.filter(event=>!event.judged),nearest=unresolved.map(event=>({event,error:Math.abs(event.beat*beatMs-elapsed)})).filter(item=>item.error<=windowMs).sort((a,b)=>a.error-b.error);const correct=nearest.find(({event})=>instrument==='drums'?state.lanes[event.lane].part===drumPart:state.lanes[event.lane]===midi);
  if(!correct){if(nearest.length){const wrong=nearest[0].event;wrong.judged=true;wrong.el?.remove();state.misses++;state.judged++;state.combo=0;document.querySelector('#game-feedback').textContent='Miss';updateRhythmStats()}else{document.querySelector('#game-feedback').textContent='Try again';state.combo=0;updateRhythmStats()}return}
  const {event,error}=correct;event.judged=true;event.el?.remove();state.judged++;state.hits++;state.combo++;state.highestCombo=Math.max(state.highestCombo,state.combo);const rating=error<=state.hitWindows.perfect?'Perfect':error<=state.hitWindows.great?'Great':'Good';if(rating==='Perfect'){state.perfect++;state.score+=300+Math.min(state.combo,50)*5;playerProgress.stats.totalPerfectHits++;if(playerProgress.stats.totalPerfectHits>=10)unlockAchievement('perfect-start')}else if(rating==='Great'){state.great++;state.score+=200+Math.min(state.combo,50)*3}else{state.good++;state.score+=120+Math.min(state.combo,50)*2}playerProgress.stats.highestCombo=Math.max(playerProgress.stats.highestCombo,state.highestCombo);if(state.highestCombo>=20)unlockAchievement('combo-master');document.querySelector('#game-feedback').textContent=rating;const hitLane=document.querySelectorAll('.game-lane')[event.lane];hitLane?.classList.add('rhythm-hit');window.setTimeout(()=>hitLane?.classList.remove('rhythm-hit'),instrument==='clarinet'?360:130);updateRhythmStats();savePlayerProgress();
}
function finishRhythmGame(message){
  if(!rhythmState)return;const finishedState=rhythmState;cancelAnimationFrame(rhythmRaf);rhythmRaf=0;rhythmState=null;stopPlayback();document.querySelector('#game-feedback').textContent=message;document.querySelector('#game-pause').textContent='Pause';document.querySelector('#countdown-overlay').classList.add('hidden');
  if(message==='Song complete'){const judged=finishedState.hits+finishedState.misses,accuracy=judged?finishedState.hits/judged:0,stars=accuracy>=.95?3:accuracy>=.8?2:accuracy>=.6?1:0,key=`${finishedState.instrument}:${selectedSong.id}`,previous=Number(playerProgress.bestScores[key]||0);playerProgress.bestScores[key]=Math.max(previous,finishedState.score);playerProgress.songStars[selectedSong.id]=Math.max(Number(playerProgress.songStars[selectedSong.id]||0),stars);playerProgress.stats.songsCompleted++;if(finishedState.instrument==='clarinet')playerProgress.stats.clarinetSongs++;unlockAchievement('first-song');if(playerProgress.stats.clarinetSongs>=5)unlockAchievement('clarinet-master');if(stars===3)unlockAchievement('three-star-player');
    let reward='Score saved to your progress.';if(selectedSong.level){const levelNo=selectedSong.level;playerProgress.completedLevels=Array.from(new Set([...playerProgress.completedLevels,levelNo])).sort((a,b)=>a-b);playerProgress.bestScores[`level-${levelNo}`]=Math.max(Number(playerProgress.bestScores[`level-${levelNo}`]||0),finishedState.score);if(finishedState.score>=selectedSong.target){const next=levelNo+1;if(next<=10&&!playerProgress.unlockedLevels.includes(next))playerProgress.unlockedLevels.push(next);reward=levelNo===10?'All levels complete!':`Target reached · Level ${Math.min(10,next)} ${next<=10?'unlocked':'complete'}`}else reward=`Target ${selectedSong.target.toLocaleString()} not reached yet · replay this level to unlock the next`;
      const count=playerProgress.completedLevels.length;if(count>=3)unlockAchievement('music-beginner');if(count>=5)unlockAchievement('rising-musician');if(count>=10)unlockAchievement('music-expert');renderLevels()}
    savePlayerProgress();renderResults({score:finishedState.score,combo:finishedState.highestCombo,perfect:finishedState.perfect,great:finishedState.great,good:finishedState.good,misses:finishedState.misses,accuracy,stars,reward});
  }
}
function renderResults(result){
  document.querySelector('#results-title').textContent=selectedSong?.name?`${selectedSong.name} · complete`:'Song complete';document.querySelector('#results-stars').textContent='★'.repeat(result.stars)+'☆'.repeat(3-result.stars);document.querySelector('#results-stats').innerHTML=`<span>Score <b>${result.score.toLocaleString()}</b></span><span>Highest combo <b>${result.combo}</b></span><span>Perfect <b>${result.perfect}</b></span><span>Great <b>${result.great}</b></span><span>Good <b>${result.good}</b></span><span>Misses <b>${result.misses}</b></span><span>Accuracy <b>${Math.round(result.accuracy*100)}%</b></span>`;document.querySelector('#results-reward').textContent=result.reward;document.querySelector('#results-panel').classList.remove('hidden');rhythmPanel.classList.add('hidden');
}
function stopRhythmGame(message='Stopped'){rhythmStartToken++;if(!rhythmState)return;cancelAnimationFrame(rhythmRaf);rhythmRaf=0;rhythmState=null;stopPlayback();document.querySelector('#game-feedback').textContent=message||'Ready';document.querySelector('#countdown-overlay').classList.add('hidden');document.querySelector('#game-pause').textContent='Pause'}
function setRhythmPaused(shouldPause){
  if(!rhythmState)return;const state=rhythmState,alreadyPaused=state.pausedAt!==null;if(shouldPause===alreadyPaused)return;const now=performance.now();
  if(shouldPause){state.pausedAt=now;cancelAnimationFrame(rhythmRaf);rhythmRaf=0;stopPlayback();void audio?.suspend().catch(error=>console.warn('Audio pause failed',error));const overlay=document.querySelector('#countdown-overlay');overlay.textContent='Paused';overlay.classList.remove('hidden');document.querySelector('#game-pause').textContent='Resume';document.querySelector('#game-feedback').textContent='Paused'}
  else{state.startAt+=now-state.pausedAt;state.pausedAt=null;void audio?.resume().catch(error=>{setAudioStatus('error','Audio blocked · interact to retry');console.warn('Audio resume failed',error)});document.querySelector('#game-pause').textContent='Pause';document.querySelector('#game-feedback').textContent='Playing';rhythmRaf=requestAnimationFrame(renderRhythmFrame)}
}
function toggleRhythmPause(){if(rhythmState)setRhythmPaused(rhythmState.pausedAt===null)}
function exitRhythmGame(toSongs=true){
  stopRhythmGame('');player.classList.remove('rhythm-playing');player.classList.toggle('rhythm-setup',toSongs&&['rhythm-picked','level'].includes(appFlow));rhythmPanel.classList.add('hidden');document.querySelector('#results-panel').classList.add('hidden');document.querySelector('#stage').classList.remove('rhythm-active');if(toSongs){document.querySelector('#song-picker').classList.remove('hidden');buildSongPicker()}else document.querySelector('#song-picker').classList.add('hidden');window.scrollTo({top:0,behavior:'smooth'});
}
function backFromSongPicker(){
  stopRhythmGame('');player.classList.remove('rhythm-setup');document.querySelector('#song-picker').classList.add('hidden');document.querySelector('#results-panel').classList.add('hidden');document.querySelector('#stage').classList.remove('rhythm-active');leaveInstrument();
}
function setupMainNavigation(){
  setupSheetMusicEditor();
  document.querySelectorAll('[data-page]').forEach(button=>button.addEventListener('click',()=>{if(composerSession?.recording)composerSession=null;stopRhythmGame('');stopPlayback();welcome.classList.add('hidden');chooser.classList.add('hidden');player.classList.add('hidden');player.classList.remove('rhythm-playing');hideHomeSubpages();const page=document.getElementById(button.dataset.page);page.classList.remove('hidden');setPrimaryTab('');if(button.dataset.page==='achievements-page')renderAchievements();if(button.dataset.page==='daily-challenge-page'){appFlow='daily-page';renderDailyChallenge()}if(button.dataset.page==='composer-page'){appFlow='composer';renderComposerPage()}}));
  document.querySelectorAll('[data-topnav]').forEach(button=>button.addEventListener('click',()=>{if(button.dataset.topnav==='play')showMainMenu();else if(button.dataset.topnav==='rhythm')openRhythmPage();else if(button.dataset.topnav==='levels')openLevelsPage();else if(button.dataset.topnav==='composer')openComposerPage()}));
  document.querySelectorAll('[data-home]').forEach(button=>button.addEventListener('click',showMainMenu));document.querySelector('.brand').addEventListener('click',event=>{event.preventDefault();showMainMenu()});
  document.querySelector('#start-button').addEventListener('click',openPlayModesPage);
  document.querySelectorAll('[data-play-mode]').forEach(button=>button.addEventListener('click',()=>{if(button.dataset.playMode==='rhythm')openRhythmPage();else openInstrumentChooser('free')}));
  document.querySelector('#chooser-back').addEventListener('click',handleChooserBack);
  document.querySelector('#change-instrument').addEventListener('click',()=>{document.querySelector('#instrument-switcher').scrollIntoView({behavior:'smooth',block:'center'});document.querySelector('#instrument-switcher button')?.focus({preventScroll:true})});
  document.querySelector('#skip-first-tutorial').addEventListener('click',()=>{playerProgress.settings.tutorialSeen=true;savePlayerProgress();document.querySelector('#first-play-tutorial').classList.add('hidden')});
  document.querySelector('#daily-challenge-start').addEventListener('click',startDailyChallenge);document.querySelector('#daily-challenge-leave').addEventListener('click',openDailyChallengePage);
  document.querySelector('#composer-record').addEventListener('click',startCompositionRecording);document.querySelector('#composer-save').addEventListener('click',saveCompositionRecording);document.querySelector('#composer-cancel').addEventListener('click',cancelComposition);document.querySelector('#composer-tempo').addEventListener('input',event=>{document.querySelector('#composer-tempo-value').textContent=`${event.target.value} BPM`});
  document.querySelector('#song-start').addEventListener('click',launchRhythmGame);
  document.querySelector('#song-back').addEventListener('click',backFromSongPicker);document.querySelector('#results-replay').addEventListener('click',launchRhythmGame);document.querySelector('#results-choose-song').addEventListener('click',openRhythmPage);
  document.querySelector('#game-back').addEventListener('click',()=>exitRhythmGame(true));document.querySelector('#game-pause').addEventListener('click',toggleRhythmPause);document.querySelector('#game-restart').addEventListener('click',launchRhythmGame);document.querySelector('#game-stop').addEventListener('click',()=>{stopPlayback();setRhythmPaused(true);document.querySelector('#game-feedback').textContent='Stopped'});
  document.querySelector('#settings-practice-tempo').addEventListener('input',event=>updatePracticeTempo(event.target.value));document.querySelector('#practice-tempo-picker').addEventListener('input',event=>updatePracticeTempo(event.target.value));document.querySelector('#settings-metronome').addEventListener('change',event=>{playerProgress.settings.metronomeEnabled=event.target.checked;document.querySelector('#metronome-picker').checked=event.target.checked;savePlayerProgress()});document.querySelector('#metronome-picker').addEventListener('change',event=>{playerProgress.settings.metronomeEnabled=event.target.checked;document.querySelector('#settings-metronome').checked=event.target.checked;savePlayerProgress()});
  document.querySelector('#rhythm-difficulty').addEventListener('change',event=>{playerProgress.settings.rhythmDifficulty=event.target.value==='advanced'?'advanced':'easy';savePlayerProgress()});
  document.querySelector('#settings-volume').addEventListener('input',event=>{const volume=Number(event.target.value);playerProgress.settings.volume=volume;document.querySelector('#volume-slider').value=String(volume);if(master&&audio)master.gain.setTargetAtTime(volume/100,audio.currentTime,.025);savePlayerProgress()});
  document.querySelector('#advanced-mode').addEventListener('change',event=>{const enabled=event.target.checked;playerProgress.settings.advancedMode=enabled;player.classList.toggle('advanced-mode',enabled);if(!enabled&&player.dataset.instrument==='clarinet'&&currentClarinetKeyboardMode==='physical')[...document.querySelectorAll('#controls .clarinet-practice-button')].find(button=>button.textContent.startsWith('Easy notes'))?.click();if(!enabled&&player.dataset.instrument==='violin'&&currentViolinKeyboardMode==='advanced')document.querySelector('#controls>.clarinet-practice-button')?.click();savePlayerProgress()});
  document.querySelector('#volume-slider').addEventListener('input',event=>{const volume=Number(event.target.value);playerProgress.settings.volume=volume;document.querySelector('#settings-volume').value=String(volume);if(master&&audio)master.gain.setTargetAtTime(volume/100,audio.currentTime,.025);savePlayerProgress()});
  document.querySelector('#reset-progress').addEventListener('click',()=>{if(!window.confirm('Reset all saved levels, scores, achievements, and settings?'))return;Object.assign(playerProgress,progressDefaults());savePlayerProgress();applySavedSettings();renderLevels();renderAchievements();document.querySelector('#settings-status').textContent='Saved progress has been reset.'});
  document.addEventListener('keydown',event=>{if(event.code!=='Space'||event.repeat||document.querySelector('#song-picker').classList.contains('hidden')||!selectedSong)return;const target=event.target;if(target instanceof Element&&target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]'))return;if(target instanceof Element&&target.id==='song-start')return;event.preventDefault();launchRhythmGame()});
  document.addEventListener('keydown',rhythmInputKey);
}
applySavedSettings();renderAchievements();renderLevels();buildSongPicker();setupMainNavigation();

