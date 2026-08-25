(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const views = [...document.querySelectorAll('.view')];
  const toast = $('toast');
  const markerModal = $('markerModal');
  const cameraBtn = $('cameraBtn');
  const viewportCameraStart = $('viewportCameraStart');
  const demoBtn = $('demoBtn');
  const stageChip = $('stageChip');
  const stageTitle = $('stageTitle');
  const stageText = $('stageText');
  const observeList = $('observeList');
  const emissionValue = $('emissionValue');
  const emissionBar = $('emissionBar');
  const storyKicker = $('storyKicker');
  const storyHeadline = $('storyHeadline');
  const storyBody = $('storyBody');
  const storyAction = $('storyAction');
  const storySteps = [...document.querySelectorAll('.story-step')];
  const hotspotWrap = $('arHotspots');
  const placementHud = $('placementHud');
  const recoveryValue = $('recoveryValue');
  const recoveryBar = $('recoveryBar');
  const recoveryHint = $('recoveryHint');
  const planCount = $('planCount');
  const treeCount = $('treeCount');
  const efficiencyCount = $('efficiencyCount');
  const solarCount = $('solarCount');
  const wasteCount = $('wasteCount');
  const buildingCount = $('buildingCount');
  const evCount = $('evCount');
  const communityCount = $('communityCount');
  const resetPlacement = $('resetPlacement');
  const quizFromAr = $('quizFromAr');
  const secureContextNote = $('secureContextNote');
  const scanDock = $('scanDock');
  const stageDock = $('stageDock');
  const quizDock = $('quizDock');
  const immersiveBtn = $('immersiveBtn');
  const immersiveClose = $('immersiveClose');
  const liveKicker = $('liveKicker');
  const liveHeadline = $('liveHeadline');
  const liveHint = $('liveHint');
  const liveEmissionBar = $('liveEmissionBar');
  const liveStoryAction = $('liveStoryAction');
  const stageTransition = $('stageTransition');
  const transitionKicker = $('transitionKicker');
  const transitionTitle = $('transitionTitle');

  let currentStage = 0;
  let maxStageReached = 0;
  let audioOn = false;
  let recoveryReady = false;
  let transitionBusy = false;
  let currentView = 'landing';

  const localHostNames = new Set(['localhost','127.0.0.1','::1']);
  const cameraContextOK = window.isSecureContext || location.protocol === 'https:' || localHostNames.has(location.hostname);
  if (secureContextNote) secureContextNote.hidden = cameraContextOK;

  const stageData = [
    {
      title:'Alam Asri', emission:18, kicker:'KONDISI AWAL',
      headline:'Lingkungan hijau tetap aktif',
      body:'Putar diorama 360°. Amati gunung, sungai, rumah, mobil, motor, dan warga yang beraktivitas tanpa kepadatan berlebihan.',
      action:'Mulai Perubahan →',
      text:'Lingkungan masih hijau dan seimbang. Mobil, motor, dan manusia tetap beraktivitas, tetapi ruang hijau masih luas, sungai bersih, dan lalu lintas belum padat.',
      observe:['Vegetasi rapat dan sungai bersih','Mobil, motor, dan warga tetap beraktivitas','Aktivitas manusia belum menekan lingkungan secara berlebihan']
    },
    {
      title:'Aktivitas Mulai Meningkat', emission:38, kicker:'TEKANAN RINGAN',
      headline:'Kawasan mulai berkembang',
      body:'Satu pabrik mulai aktif, kendaraan bertambah, dan beberapa rumah mulai memakai AC. Lingkungan masih hijau, tetapi tekanan mulai terlihat.',
      action:'Lihat Peningkatan →',
      text:'Aktivitas pabrik mulai meningkat. Jumlah mobil dan sepeda motor bertambah, penggunaan AC di rumah mulai terlihat, tetapi tanah dan vegetasi belum langsung berubah cokelat.',
      observe:['Aktivitas pabrik mulai meningkat','Jumlah kendaraan mulai bertambah','Penggunaan AC di rumah mulai meningkat']
    },
    {
      title:'Aktivitas Semakin Padat', emission:66, kicker:'TEKANAN SEDANG',
      headline:'Sumber emisi bertambah bertahap',
      body:'Area pabrik meluas, lalu lintas semakin ramai, unit AC bertambah, sampah mulai menumpuk, dan warna lingkungan perlahan mengering.',
      action:'Lihat Kondisi Terparah →',
      text:'Tekanan lingkungan memburuk secara bertahap. Pabrik dan cerobong bertambah, kendaraan semakin banyak, penggunaan AC meningkat, vegetasi menipis, dan tanah mulai menguning kecokelatan.',
      observe:['Aktivitas pabrik meningkat dan kawasan industri meluas','Jumlah mobil dan sepeda motor bertambah','Penggunaan AC di rumah meningkat']
    },
    {
      title:'Emisi Karbon Sangat Tinggi', emission:94, kicker:'KRISIS EMISI',
      headline:'Tekanan lingkungan mencapai puncak',
      body:'Asap, kemacetan, sampah, penggunaan air yang tidak efisien, tanah kering, dan kerusakan vegetasi terjadi bersamaan.',
      action:'Mulai Pemulihan →',
      text:'Emisi tinggi dan perilaku tidak berkelanjutan memperburuk udara, air, tanah, vegetasi, dan kenyamanan kawasan.',
      observe:['Asap dan kabut polusi meningkat','Tanah dan vegetasi memburuk','Lalu lintas, sampah, dan pemborosan air memperparah kondisi']
    },
    {
      title:'Transformasi Kota Hijau', emission:86, kicker:'8 ATRIBUT KOTA HIJAU',
      headline:'Lengkapi delapan indikator Kota Hijau',
      body:'Drag delapan aset 3D yang mewakili perencanaan kota, ruang terbuka hijau, konsumsi energi, pengelolaan energi, limbah 3R, bangunan hemat energi, transportasi berkelanjutan, dan komunitas hijau.',
      action:'Lengkapi 8 Indikator',
      text:'Setiap aset mewakili satu atribut Kota Hijau. Tahap 6 terbuka setelah seluruh delapan indikator terpenuhi.',
      observe:['Perencanaan kota dan ruang terbuka hijau','Efisiensi energi, pengelolaan energi, limbah 3R, dan bangunan hemat energi','Transportasi berkelanjutan serta peran masyarakat sebagai komunitas hijau']
    },
    {
      title:'Kota Hijau Terwujud', emission:22, kicker:'8 / 8 INDIKATOR',
      headline:'Seluruh atribut Kota Hijau terpenuhi',
      body:'Perencanaan ramah lingkungan, ruang hijau, efisiensi energi, 3R, bangunan hemat energi, transportasi berkelanjutan, dan komunitas hijau bekerja sebagai satu sistem.',
      action:'Lanjut ke Kuis →',
      text:'Kota tetap aktif, tetapi pembangunan dan aktivitasnya sekarang ditopang oleh delapan atribut Kota Hijau yang saling melengkapi.',
      observe:['Ruang terbuka hijau dan bangunan hemat energi terlihat jelas','Energi dan limbah dikelola lebih efisien','Transportasi berkelanjutan dan komunitas hijau aktif']
    }
  ];
  const STAGE_COUNT=stageData.length;
  const SEVERE_STAGE=3;
  const RECOVERY_STAGE=4;
  const FINAL_STAGE=5;

  const hotspotData = {
    factory:['Pabrik & bahan bakar fosil','Pembakaran bahan bakar fosil pada aktivitas industri meningkatkan emisi gas rumah kaca dan polutan udara.'],
    river:['Sungai & kualitas lingkungan','Tekanan pembangunan dan pencemaran dapat menurunkan kualitas air serta mengganggu habitat sungai.'],
    ecosystem:['Ekosistem','Berkurangnya vegetasi dan perubahan lingkungan mengurangi habitat dan memperbesar tekanan terhadap ekosistem.']
  };

  function showToast(message,duration=2800){
    if(!toast)return;
    toast.textContent=message;toast.classList.add('show');
    clearTimeout(showToast.t);showToast.t=setTimeout(()=>toast.classList.remove('show'),duration);
  }
  window.showClimateToast=showToast;

  function updateDock(){
    document.querySelectorAll('.dock-item').forEach(x=>x.classList.remove('active'));
    const target = currentView==='landing'?'landing':currentView==='material'?'material':currentView==='quiz'||currentView==='result'?'quiz':null;
    if(target) document.querySelector(`[data-dock="${target}"]`)?.classList.add('active');
  }

  function go(id){
    currentView=id;
    views.forEach(v=>v.classList.toggle('is-active',v.id===id));
    updateDock();
    window.scrollTo({top:0,behavior:'smooth'});
    if(id!=='ar'){
      setImmersive(false);
      window.RealisticAR?.stop();
      if(cameraBtn)cameraBtn.textContent='Aktifkan Kamera';
    }
    if(id==='quiz') renderQuestion();
  }
  document.querySelectorAll('[data-go]').forEach(el=>el.addEventListener('click',()=>go(el.dataset.go)));

  $('markerBtn')?.addEventListener('click',()=>markerModal?.showModal());
  $('markerClose')?.addEventListener('click',()=>markerModal?.close());
  markerModal?.addEventListener('click',e=>{if(e.target===markerModal)markerModal.close();});

  $('soundToggle')?.addEventListener('click',e=>{
    audioOn=!audioOn;e.currentTarget.textContent=audioOn?'♫':'♪';
    showToast(audioOn?'Narasi suara aktif':'Narasi suara nonaktif');
    if(audioOn)narrateStage();else speechSynthesis?.cancel();
  });

  function narrateStage(){
    if(!audioOn||!('speechSynthesis'in window))return;
    speechSynthesis.cancel();
    const d=stageData[currentStage];
    const u=new SpeechSynthesisUtterance(`${d.title}. ${d.text}`);
    u.lang='id-ID';u.rate=.92;speechSynthesis.speak(u);
  }

  function setEmission(v){
    const n=Math.max(0,Math.min(100,Math.round(v)));
    if(emissionValue) emissionValue.textContent=`${n}%`;
    if(emissionBar) emissionBar.style.width=`${n}%`;
    if(liveEmissionBar) liveEmissionBar.style.width=`${n}%`;
  }

  function setProgress(stage){
    storySteps.forEach((step,index)=>{
      step.classList.toggle('is-active',index===stage);
      step.classList.toggle('is-done',index<stage);
    });
  }

  function setRecoveryUI(detail={
    plan:0,trees:0,efficiency:0,solar:0,waste:0,building:0,ev:0,community:0,
    indicatorCount:0,recovery:0,emission:86,ready:false
  }){
    const counts={
      plan:detail.plan??0,
      trees:detail.trees??0,
      efficiency:detail.efficiency??0,
      solar:detail.solar??0,
      waste:detail.waste??0,
      building:detail.building??0,
      ev:detail.ev??0,
      community:detail.community??0
    };

    const indicatorCount=Number.isFinite(detail.indicatorCount)
      ?detail.indicatorCount
      :Object.values(counts).filter(v=>v>=1).length;

    const percent=Math.round((indicatorCount/8)*100);
    recoveryReady=Boolean(detail.ready);

    if(recoveryValue)recoveryValue.textContent=`${indicatorCount} / 8`;
    if(recoveryBar)recoveryBar.style.width=`${percent}%`;

    if(planCount)planCount.textContent=counts.plan;
    if(treeCount)treeCount.textContent=counts.trees;
    if(efficiencyCount)efficiencyCount.textContent=counts.efficiency;
    if(solarCount)solarCount.textContent=counts.solar;
    if(wasteCount)wasteCount.textContent=counts.waste;
    if(buildingCount)buildingCount.textContent=counts.building;
    if(evCount)evCount.textContent=counts.ev;
    if(communityCount)communityCount.textContent=counts.community;

    setEmission(detail.emission??86);

    const missing=[];
    if(counts.plan<1)missing.push('perencanaan & perancangan kota ramah lingkungan');
    if(counts.trees<1)missing.push('ruang terbuka hijau');
    if(counts.efficiency<1)missing.push('konsumsi energi efisien');
    if(counts.solar<1)missing.push('pengelolaan energi efisien');
    if(counts.waste<1)missing.push('pengelolaan limbah 3R');
    if(counts.building<1)missing.push('bangunan hemat energi');
    if(counts.ev<1)missing.push('transportasi berkelanjutan');
    if(counts.community<1)missing.push('komunitas hijau');

    if(recoveryHint){
      recoveryHint.textContent=recoveryReady
        ?'8 / 8 atribut Kota Hijau terpenuhi. Tahap Kota Hijau sudah dapat dibuka.'
        :missing.length
          ?`Belum terpenuhi (${8-indicatorCount}): ${missing.slice(0,3).join(', ')}${missing.length>3?'…':''}`
          :'Lengkapi seluruh atribut Kota Hijau.';
    }

    if(currentStage===RECOVERY_STAGE){
      storyAction.textContent=recoveryReady?'Lihat Kota Hijau →':`${indicatorCount} / 8 Indikator`;
      storyAction.classList.toggle('is-disabled',!recoveryReady);

      if(liveHint){
        liveHint.textContent=recoveryReady
          ?'8 / 8 indikator terpenuhi. Lihat hasil Kota Hijau.'
          :`${indicatorCount} / 8 indikator Kota Hijau terpenuhi. Pilih atribut berikutnya dari toolbar.`;
      }

      if(liveStoryAction){
        liveStoryAction.textContent=recoveryReady?'Lihat Kota Hijau →':`${indicatorCount} / 8 Indikator`;
        liveStoryAction.classList.toggle('is-disabled',!recoveryReady);
      }

      quizFromAr.disabled=true;
      quizFromAr.textContent=recoveryReady?'Lihat hasil Kota Hijau':'Quiz terkunci';
    }
  }

  async function updateStage(i,{force=false,announce=true}={}){
    const next=Math.max(0,Math.min(FINAL_STAGE,i));
    if(next===FINAL_STAGE&&!recoveryReady){showToast('Lengkapi seluruh 8 atribut Kota Hijau terlebih dahulu.');return;}
    if(!force&&next>maxStageReached+1){showToast('Selesaikan tahap sebelumnya terlebih dahulu.');return;}
    currentStage=next;maxStageReached=Math.max(maxStageReached,currentStage);
    const d=stageData[currentStage];
    stageChip.textContent=`Tahap ${currentStage+1} / ${STAGE_COUNT}`;
    stageTitle.textContent=d.title;stageText.textContent=d.text;
    observeList.innerHTML=d.observe.map(x=>`<li>${x}</li>`).join('');
    storyKicker.textContent=d.kicker;storyHeadline.textContent=d.headline;storyBody.textContent=d.body;
    storyAction.textContent=d.action;storyAction.classList.remove('is-disabled');
    if(liveKicker)liveKicker.textContent=d.kicker;
    if(liveHeadline)liveHeadline.textContent=d.headline;
    if(liveHint)liveHint.textContent=currentStage===RECOVERY_STAGE
      ?'Lengkapi 8 atribut Kota Hijau melalui toolbar aset 3D.'
      :currentStage===FINAL_STAGE
        ?'Bandingkan langit, sungai, vegetasi, dan energi bersih dengan tahap emisi tinggi.'
        :'Gerakkan kamera ke kiri dan kanan; sudut vertikal dijaga tetap stabil.';
    if(liveStoryAction){
      liveStoryAction.textContent=d.action.replace(/[^\x00-\x7F]+$/,' →');
      liveStoryAction.classList.remove('is-disabled');
    }
    setEmission(d.emission);setProgress(currentStage);
    hotspotWrap?.classList.toggle('show',currentStage===SEVERE_STAGE);
    $('arStage')?.classList.toggle('stage-polluted',currentStage===SEVERE_STAGE||currentStage===RECOVERY_STAGE);
    $('arStage')?.classList.toggle('stage-recovered',currentStage===FINAL_STAGE);
    if(placementHud)placementHud.hidden=currentStage!==RECOVERY_STAGE;
    if(currentStage===RECOVERY_STAGE)setRecoveryUI(window.RealisticAR?.recoveryState||undefined);
    else if(currentStage===FINAL_STAGE){recoveryReady=true;quizFromAr.disabled=false;quizFromAr.textContent='Lanjut Kuis';}
    else{recoveryReady=false;quizFromAr.disabled=true;quizFromAr.textContent='Quiz terkunci';}
    if(announce&&stageTransition&&currentStage>0){
      if(transitionKicker)transitionKicker.textContent=d.kicker;
      if(transitionTitle)transitionTitle.textContent=d.title;
      stageTransition.classList.remove('show');
      void stageTransition.offsetWidth;
      stageTransition.classList.add('show');
      setTimeout(()=>stageTransition.classList.remove('show'),1250);
    }
    try{await window.RealisticAR?.setStage(currentStage);}catch(err){console.warn(err)}
    narrateStage();
  }

  storySteps.forEach((step,index)=>step.addEventListener('click',()=>updateStage(index)));

  storyAction?.addEventListener('click',async()=>{
    if(transitionBusy)return;
    if(currentStage===FINAL_STAGE)return go('quiz');
    if(currentStage===RECOVERY_STAGE){
      if(!recoveryReady)return showToast('Lengkapi seluruh 8 atribut Kota Hijau terlebih dahulu.');
    }
    transitionBusy=true;
    const msgs=['Aktivitas mulai meningkat…','Pabrik, kendaraan, dan AC semakin bertambah…','Kondisi mencapai tahap paling parah…','Mode drag & drop 3D aktif.','Solusi bekerja — lingkungan mulai pulih…'];
    showToast(msgs[currentStage],3000);
    await updateStage(currentStage+1);
    transitionBusy=false;
  });
  liveStoryAction?.addEventListener('click',()=>storyAction?.click());

  function setImmersive(active){
    document.body.classList.toggle('immersive-ar',active);
    if(immersiveBtn)immersiveBtn.textContent=active?'Mode Normal':'Layar Penuh';
  }
  immersiveBtn?.addEventListener('click',()=>setImmersive(!document.body.classList.contains('immersive-ar')));
  immersiveClose?.addEventListener('click',()=>setImmersive(false));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')setImmersive(false)});
  window.addEventListener('climate-ar-tracking',e=>{
    $('arStage')?.classList.toggle('tracking-locked',Boolean(e.detail?.found));
  });

  document.querySelectorAll('[data-hotspot]').forEach(btn=>btn.addEventListener('click',()=>{
    const item=hotspotData[btn.dataset.hotspot];
    if(item)showToast(`${item[0]} — ${item[1]}`,5200);
  }));

  resetPlacement?.addEventListener('click',()=>{
    window.RealisticAR?.resetRecovery();showToast('Seluruh atribut Kota Hijau direset.');
  });
  window.addEventListener('climate-ar-placement',e=>setRecoveryUI(e.detail));
  window.addEventListener('climate-ar-recovery-ready',e=>{
    setRecoveryUI(e.detail);showToast('8 / 8 atribut Kota Hijau terpenuhi!',4200);
  });

  async function toggleCamera(){
    if(!cameraContextOK){
      showToast('Kamera membutuhkan HTTPS/localhost. Android lokal gunakan start-android-usb.bat.');
      secureContextNote?.scrollIntoView({behavior:'smooth',block:'center'});return;
    }
    try{
      if(window.RealisticAR?.running){
        await window.RealisticAR.stop();cameraBtn.textContent='Aktifkan Kamera';
      }else{
        if(!window.RealisticAR?.start){
          throw new Error('AR_ENGINE_NOT_READY');
        }
        await window.RealisticAR.start();
        cameraBtn.textContent='Matikan Kamera';
        if(matchMedia('(max-width: 680px)').matches)setImmersive(true);
        if(demoBtn)demoBtn.textContent='Preview 3D';
      }
    }catch(e){
      const message=
        e?.name==='NotAllowedError'
          ?'Izin kamera ditolak. Aktifkan permission kamera browser.'
        :e?.name==='NotFoundError'
          ?'Kamera tidak ditemukan pada perangkat.'
        :e?.name==='NotReadableError'
          ?'Kamera tidak dapat digunakan. Tutup aplikasi lain yang sedang memakai kamera.'
        :e?.name==='SecurityError'
          ?'Kamera hanya dapat digunakan melalui HTTPS/localhost.'
        :e?.message==='AR_ENGINE_NOT_READY'
          ?'Engine AR gagal dimuat. Reload halaman (Ctrl+F5) lalu coba lagi.'
        :'Kamera gagal dibuka. Cek permission browser lalu coba lagi.';
      showToast(message,5200);
    }
  }
  cameraBtn?.addEventListener('click',toggleCamera);

  viewportCameraStart?.addEventListener('click',async()=>{
    if(window.RealisticAR?.running)return;
    await toggleCamera();
  });

  // Tapping the scan reticle can also start the camera when it is still off.
  $('trackingReticle')?.addEventListener('click',async()=>{
    if(!window.RealisticAR?.running)await toggleCamera();
  });

  window.addEventListener('climate-ar-detector-ready',e=>{
    if(e.detail?.ready){
      showToast('Kamera siap. Arahkan ke gambar AR.',2600);
    }else{
      showToast('Kamera aktif, tetapi gambar belum bisa dibaca. Periksa internet lalu muat ulang halaman.',5200);
    }
  });

  demoBtn?.addEventListener('click',async()=>{
    if(window.RealisticAR?.preview){window.RealisticAR.stopPreview();demoBtn.textContent='Preview 3D';}
    else{await window.RealisticAR?.startPreview();demoBtn.textContent='Tutup Preview';cameraBtn.textContent='Aktifkan Kamera';}
  });

  scanDock?.addEventListener('click',async()=>{
    if(currentView!=='ar')go('ar');
    // Keep getUserMedia in the original tap/click task. Chrome Android can
    // discard transient user activation when camera start is deferred through
    // setTimeout, causing a delayed/missing permission prompt or a stuck start.
    await toggleCamera();
  });
  stageDock?.addEventListener('click',()=>{
    if(currentView!=='ar')go('ar');
    setTimeout(()=>document.querySelector('.stage-rail')?.scrollIntoView({behavior:'smooth',block:'center'}),80);
  });
  quizDock?.addEventListener('click',()=>{
    if(currentStage===FINAL_STAGE&&recoveryReady)return go('quiz');
    showToast('Selesaikan pemulihan dan lihat lingkungan hijau terlebih dahulu.');
    if(currentView!=='ar')go('ar');
  });
  quizFromAr?.addEventListener('click',()=>{
    if(currentStage!==FINAL_STAGE||!recoveryReady)return showToast('Lihat hasil lingkungan hijau terlebih dahulu.');
    go('quiz');
  });

  const questions=[
    {q:'Apa yang paling mungkin terjadi ketika daerah hijau berkembang menjadi kawasan industri tanpa pengendalian lingkungan?',o:['Emisi selalu turun','Penggunaan energi dan emisi dapat meningkat sehingga kualitas lingkungan menurun','Jumlah pepohonan otomatis meningkat','Suhu selalu menurun'],a:1},
    {q:'Mengapa penggunaan bahan bakar fosil berkaitan dengan peningkatan emisi karbon?',o:['Pembakarannya melepaskan gas rumah kaca','Menghasilkan oksigen tambahan','Semua kendaraan menyerap karbon','Tidak terjadi pembakaran'],a:0},
    {q:'Kondisi mana yang sesuai dengan tahap emisi karbon tinggi?',o:['Udara lebih bersih','Tidak ada aktivitas manusia','Asap meningkat, vegetasi menurun, dan tekanan lingkungan bertambah','Seluruh energi berasal dari surya'],a:2},
    {q:'Mengapa panel surya dan ruang hijau digunakan bersama pada tahap pemulihan?',o:['Menambah asap','Mengurangi ketergantungan fosil sekaligus membantu memulihkan lingkungan','Menghilangkan kebutuhan listrik','Pohon menghasilkan bahan bakar fosil'],a:1},
    {q:'Apa manfaat AR pada pembelajaran ini?',o:['Menggantikan semua diskusi','Membuat perubahan lingkungan dapat diamati dan dimanipulasi secara visual/interaktif','Menghilangkan sebab-akibat','Hanya memperindah website'],a:1}
  ];
  let qIndex=0;const answers=Array(questions.length).fill(null);
  const qCard=$('questionCard'),qCount=$('quizCount'),qBar=$('quizProgressBar'),qPrev=$('quizPrev'),qNext=$('quizNext');

  function renderQuestion(){
    if(!qCard)return;const item=questions[qIndex];
    qCount.textContent=`${qIndex+1}/${questions.length}`;qBar.style.width=`${((qIndex+1)/questions.length)*100}%`;
    qCard.innerHTML=`<div class="q-index">PERTANYAAN ${String(qIndex+1).padStart(2,'0')}</div><h3>${item.q}</h3><div class="options">${item.o.map((o,i)=>`<label class="option ${answers[qIndex]===i?'is-selected':''}"><input type="radio" name="answer" value="${i}" ${answers[qIndex]===i?'checked':''}><span>${o}</span></label>`).join('')}</div>`;
    qCard.querySelectorAll('input').forEach(inp=>inp.addEventListener('change',e=>{
      answers[qIndex]=Number(e.target.value);qCard.querySelectorAll('.option').forEach(x=>x.classList.remove('is-selected'));e.target.closest('.option').classList.add('is-selected');
    }));
    qPrev.disabled=qIndex===0;qPrev.style.opacity=qIndex===0?'.45':'1';qNext.textContent=qIndex===questions.length-1?'Lihat Hasil →':'Berikutnya →';
  }
  qPrev?.addEventListener('click',()=>{if(qIndex>0){qIndex--;renderQuestion()}});
  qNext?.addEventListener('click',()=>{
    if(answers[qIndex]===null)return showToast('Pilih satu jawaban terlebih dahulu.');
    if(qIndex<questions.length-1){qIndex++;renderQuestion()}else finishQuiz();
  });
  function finishQuiz(){
    const correct=answers.reduce((n,a,i)=>n+(a===questions[i].a?1:0),0),score=correct*20;
    $('scoreValue').textContent=score;$('correctValue').textContent=`${correct}/5`;
    $('resultLabel').textContent=score>=80?'Sangat Baik':score>=60?'Baik':'Perlu Ulang';
    $('resultMessage').textContent=score>=80?'Kamu memahami hubungan aktivitas manusia, emisi, dampak lingkungan, energi bersih, dan penghijauan dengan sangat baik.':score>=60?'Pemahaman dasarmu sudah baik. Coba ulangi bagian AR yang masih kurang jelas.':'Ulangi enam tahap AR dan perhatikan bagaimana kondisi lokasi berubah.';
    document.querySelector('.score-ring').style.background=`conic-gradient(var(--green) ${score*3.6}deg,#e6eee9 0deg)`;
    localStorage.setItem('climateARScore',String(score));go('result');
  }
  $('retryQuiz')?.addEventListener('click',()=>{qIndex=0;answers.fill(null);go('quiz')});

  const init=()=>{updateStage(0,{force:true,announce:false});updateDock()};
  if(window.RealisticAR)init();else window.addEventListener('realistic-ar-ready',init,{once:true});
})();
