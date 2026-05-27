/* ============================================================
   nmt-mode.js — опційний «Режим іспиту (НМТ)»
   Презентаційний шар поверх наявного тесту. НЕ переписує
   контент чи підрахунок: читає ті самі select/radio[name="qN"]
   з data-correct, показує одне завдання-екран за раз у стилі
   реального інтерфейсу УЦОЯО, а на «Завершити» клікає наявний
   #submitBtn → бал ідентичний навчальному режиму.

   Конфіг (необов'язковий) задається в тесті:
     window.NMT_EXAM_CONFIG = {
       subject: "Англійська мова",       // напис на вкладці
       screenSelector: "section.task",   // що вважати «екраном»
       timerMinutes: 60,                 // ліміт часу
       submitSelector: "#submitBtn",     // наявна кнопка підрахунку
       resultSelector: "#result"         // наявний блок результату
     };
   Працює і без конфігу — з розумними дефолтами.
   ============================================================ */
(function(){
  "use strict";

  function init(){
    var cfg = Object.assign({
      subject: "Тест НМТ",
      screenSelector: "section.task",
      timerMinutes: 60,
      submitSelector: "#submitBtn",
      resultSelector: "#result"
    }, (window.NMT_EXAM_CONFIG || {}));

    var screens = Array.prototype.slice.call(document.querySelectorAll(cfg.screenSelector));
    if(!screens.length) return; // нема з чим працювати — тихо виходимо

    // позначаємо екрани
    screens.forEach(function(s,i){ s.setAttribute("data-exam-screen", i); });

    // --- мапа завдань: підтримує дві моделі тестів ---
    //   А) Day-8: анкер з [data-n] (li.mc/match/short або select.gap.cloze); select часто БЕЗ name
    //   Б) Day-3: input/select з name="qN" (matchrow / gapped-text, що не мають data-n)
    // Збираємо за номером завдання з дедуплікацією (A має пріоритет).
    var qMap = {};
    screens.forEach(function(screen, si){
      screen.querySelectorAll("[data-n]").forEach(function(el){
        var n = parseInt(el.getAttribute("data-n"), 10);
        if(isNaN(n) || qMap[n]) return;
        qMap[n] = { n:n, screenIndex:si, el:el };
      });
    });
    screens.forEach(function(screen, si){
      screen.querySelectorAll('select[name^="q"], input[name^="q"]').forEach(function(el){
        var n = parseInt(el.name.replace(/[^0-9]/g,""), 10);
        if(isNaN(n) || qMap[n]) return;
        qMap[n] = { n:n, screenIndex:si, el:el };
      });
    });
    var qList = Object.keys(qMap).map(function(k){ return qMap[k]; });
    if(!qList.length) return;
    qList.sort(function(a,b){ return a.n - b.n; });
    var total = qList.length;

    // чи дано відповідь на анкер (select / radio-група / текстове поле / контейнер li)
    function elAnswered(el){
      if(!el) return false;
      if(el.tagName === "SELECT") return el.value !== "";
      if(el.tagName === "INPUT"){
        if(el.type === "radio"){
          return el.name ? !!document.querySelector('input[type=radio][name="'+el.name+'"]:checked') : el.checked;
        }
        return String(el.value || "").trim() !== "";
      }
      // контейнер: шукаємо відповідь усередині
      if(el.querySelector('input[type=radio]:checked')) return true;
      var sels = el.querySelectorAll('select');
      for(var i=0;i<sels.length;i++){ if(sels[i].value !== "") return true; }
      var txt = el.querySelectorAll('input[type=text], input[inputmode], input.numin');
      for(var j=0;j<txt.length;j++){ if(String(txt[j].value||"").trim() !== "") return true; }
      return false;
    }
    function isAnswered(item){ return elAnswered(item.el); }
    function screenIsMatching(si){
      return !!screens[si].querySelector('select');
    }
    function screenQNums(si){
      return qList.filter(function(it){ return it.screenIndex === si; }).map(function(it){ return it.n; });
    }

    /* ---------- Лаунчер ---------- */
    var progress = document.querySelector(".progress") || screens[0];
    var launch = document.createElement("div");
    launch.className = "exam-launch";
    launch.innerHTML =
      '🎓 <b>Режим іспиту (НМТ)</b> — пройди цей тест у вигляді справжнього інтерфейсу НМТ: '
      + 'таймер угорі, бокова панель завдань праворуч, одне завдання за раз, фінальна таблиця-зведення.'
      + '<div class="el-row"><button type="button" id="examStartBtn">Почати в режимі іспиту →</button>'
      + '<small>Підказки 💡 лишаються доступними. Звичайний режим (гортати) — просто скролай нижче.</small></div>';
    progress.parentNode.insertBefore(launch, progress);
    document.getElementById("examStartBtn").addEventListener("click", activate);

    /* ---------- Збірка хрому ---------- */
    var bar, gridCells, timerEl, footPos, prevBtn, nextBtn, dialogBack, dialog, timerInt, t0, current = 0, built = false;

    function buildChrome(){
      if(built) return; built = true;

      // верхній бар
      bar = el('div','exam-bar exam-chrome');
      bar.innerHTML =
        '<div class="eb-brand">УЦОЯО · НМТ<small>Український центр оцінювання якості освіти</small></div>'
        + '<div class="eb-tab">'+esc(cfg.subject)+'</div>'
        + '<div class="eb-spacer"></div>'
        + '<div class="eb-timer" id="ebTimer"><span class="eb-mute">🔊</span><span id="ebTime">0:00:00</span></div>'
        + '<button type="button" class="eb-btn" id="ebFull">⛶ На весь екран</button>'
        + '<button type="button" class="eb-btn eb-finish" id="ebFinish">Завершити роботу</button>';
      document.body.appendChild(bar);
      timerEl = bar.querySelector("#ebTimer");
      bar.querySelector("#ebFinish").addEventListener("click", askFinish);
      bar.querySelector("#ebFull").addEventListener("click", toggleFull);

      // бокова панель завдань
      var grid = el('div','exam-grid exam-chrome');
      grid.innerHTML = '<h4>Завдання</h4><div class="eg-cells" id="egCells"></div>'
        + '<div class="eg-legend"><div><span class="lg-ans"></span>відповідь надано</div>'
        + '<div><span class="lg-cur"></span>поточне завдання</div></div>';
      document.body.appendChild(grid);
      var cellsWrap = grid.querySelector("#egCells");
      gridCells = [];
      qList.forEach(function(it){
        var c = el('div','eg-cell');
        c.textContent = it.n;
        c.addEventListener("click", function(){ goTo(it.screenIndex); });
        cellsWrap.appendChild(c);
        gridCells.push(c);
      });

      // нижня панель
      var foot = el('div','exam-foot exam-chrome');
      foot.innerHTML =
        '<button type="button" class="ef-prev" id="efPrev">← Назад</button>'
        + '<div class="ef-pos" id="efPos"></div>'
        + '<button type="button" class="ef-next" id="efNext"></button>';
      document.body.appendChild(foot);
      footPos = foot.querySelector("#efPos");
      prevBtn = foot.querySelector("#efPrev");
      nextBtn = foot.querySelector("#efNext");
      prevBtn.addEventListener("click", function(){ goTo(current-1); });
      nextBtn.addEventListener("click", onNext);

      // діалог (без класу exam-chrome: має лишатися видимим і після виходу з exam-mode,
      // бо фінальну таблицю показуємо вже у звичайному layout)
      dialogBack = el('div','exam-dialog-back');
      dialog = el('div','exam-dialog');
      dialogBack.appendChild(dialog);
      document.body.appendChild(dialogBack);

      // оновлення станів комірок при будь-якій зміні відповіді
      document.addEventListener("change", refreshGrid);
      document.addEventListener("input", refreshGrid); // для текстових (short) полів
    }

    /* ---------- Активація / навігація ---------- */
    function activate(){
      buildChrome();
      document.body.classList.add("exam-mode");
      window.__nmtExamMode = true;
      window.__nmtExamActive = true; // сигнал інлайн-таймеру тесту не робити авто-здачу (фініш веде exam-mode)
      current = 0;
      t0 = Date.now();
      startTimer();
      goTo(0);
      window.scrollTo(0,0);
    }

    function goTo(i){
      if(i < 0 || i >= screens.length) return;
      screens.forEach(function(s){ s.classList.remove("exam-current"); });
      screens[i].classList.add("exam-current");
      current = i;
      // прокрутка контенту вгору під баром
      window.scrollTo(0, 0);
      updateFoot();
      refreshGrid();
    }

    function onNext(){
      if(current >= screens.length - 1){ askFinish(); return; }
      goTo(current + 1);
    }

    function updateFoot(){
      var nums = screenQNums(current);
      var label = nums.length > 1
        ? ("Завдання " + nums[0] + "–" + nums[nums.length-1])
        : ("Завдання " + nums[0]);
      footPos.textContent = label + " · екран " + (current+1) + " з " + screens.length;
      prevBtn.disabled = current === 0;
      var last = current === screens.length - 1;
      if(last){
        nextBtn.textContent = "Завершити роботу";
        nextBtn.classList.add("finish");
      } else {
        nextBtn.textContent = (screenIsMatching(current) ? "Зберегти відповідь →" : "Підтвердити відповідь →");
        nextBtn.classList.remove("finish");
      }
    }

    function refreshGrid(){
      if(!gridCells) return;
      qList.forEach(function(it, idx){
        var c = gridCells[idx];
        c.classList.toggle("answered", isAnswered(it));
        c.classList.toggle("current", it.screenIndex === current);
      });
    }

    /* ---------- Таймер Г:ХХ:СС ---------- */
    function startTimer(){
      var limit = Math.round(cfg.timerMinutes * 60);
      function fmt(s){
        var h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
        return h + ":" + String(m).padStart(2,"0") + ":" + String(sec).padStart(2,"0");
      }
      function tick(){
        var elapsed = Math.floor((Date.now()-t0)/1000);
        var left = limit - elapsed;
        var timeSpan = document.getElementById("ebTime");
        if(left <= 0){
          if(timeSpan) timeSpan.textContent = "0:00:00";
          timerEl.classList.add("danger");
          clearInterval(timerInt);
          doFinish(true);
          return;
        }
        if(timeSpan) timeSpan.textContent = fmt(left);
        timerEl.classList.toggle("warn", left <= 600 && left > 120);
        timerEl.classList.toggle("danger", left <= 120);
      }
      tick();
      timerInt = setInterval(tick, 1000);
    }

    /* ---------- Завершення ---------- */
    function askFinish(){
      var un = qList.filter(function(it){ return !isAnswered(it); }).length;
      dialog.innerHTML =
        '<h3>Завершити роботу над тестом?</h3>'
        + '<p>Виконано завдань: <b>' + (total-un) + ' з ' + total + '</b>.</p>'
        + (un ? '<div class="ed-warn">⚠️ Без відповіді залишилось <b>'+un+'</b> завдань. На реальному НМТ повернутися до завдань після завершення <b>неможливо</b>.</div>'
              : '<div class="ed-warn">⚠️ Зверніть увагу: на реальному НМТ повернутися до завдань після завершення <b>неможливо</b>.</div>')
        + '<div class="ed-actions">'
        + '<button type="button" class="ed-yes" id="edYes">Так, завершити</button>'
        + '<button type="button" class="ed-no" id="edNo">Повернутися до завдань</button>'
        + '</div>';
      dialogBack.classList.add("on");
      dialog.querySelector("#edNo").addEventListener("click", function(){ dialogBack.classList.remove("on"); });
      dialog.querySelector("#edYes").addEventListener("click", function(){ doFinish(false); });
    }

    function doFinish(byTimeout){
      if(timerInt) clearInterval(timerInt);
      var spentSec = Math.floor((Date.now()-t0)/1000);
      // виходимо з екзаменаційного layout, щоб наявний підрахунок показав повний розбір
      document.body.classList.remove("exam-mode");
      // запускаємо НАЯВНИЙ підрахунок (бал ідентичний навчальному режиму)
      var submit = document.querySelector(cfg.submitSelector);
      if(submit) submit.click();
      // власна позначка режиму в трекінг (best-effort)
      try{
        if(typeof window.taSend === "function"){
          var c = (typeof window.taContact === "function") ? window.taContact() : {};
          window.taSend("exam_mode", Object.assign({}, c, {
            mode: "exam",
            by_timeout: !!byTimeout,
            answered: qList.filter(isAnswered).length,
            total: total,
            exam_time_sec: spentSec
          }));
        }
      }catch(e){}
      showCompletion(byTimeout);
    }

    function showCompletion(byTimeout){
      // дістаємо бал з готового звіту наявного коду
      var rep = window.__lastReport || "";
      var mScore = rep.match(/Рахунок:\s*(\d+)\s*\/\s*(\d+)\s*\((\d+)%\)/);
      // тестовий бал НМТ: ловимо число перед «/200» (формат напису різниться між тестами,
      // напр. «Шкала НМТ: 195/200» vs «Шкала НМТ (орієнтовно): 192/200»)
      var mNmt = rep.match(/(\d+)\s*\/\s*200/);
      var answered = qList.filter(isAnswered).length;
      var scoreCell = mNmt ? (mNmt[1] + " / 200") : "—";
      var pctTxt = mScore ? (mScore[1] + "/" + mScore[2] + " · " + mScore[3] + "%") : "";

      dialog.innerHTML =
        '<h3>Ви завершили роботу над тестом</h3>'
        + (byTimeout ? '<div class="ed-warn">⏱ Час вичерпано — роботу завершено автоматично.</div>' : '')
        + '<table><thead><tr><th>Назва навчального предмета</th><th>Кількість виконаних завдань</th><th>Тестовий бал</th></tr></thead>'
        + '<tbody><tr><td>'+esc(cfg.subject)+'</td><td class="num">'+answered+' / '+total+'</td>'
        + '<td class="num"><span class="ed-score">'+scoreCell+'</span></td></tr></tbody></table>'
        + (pctTxt ? '<p style="color:var(--muted,#5a5a5e);font-size:16px">Правильних відповідей: '+pctTxt+'</p>' : '')
        + '<div class="ed-warn">Повернутися до завдань неможливо. Нижче — детальний розбір з підказками та рішеннями для кожного завдання.</div>'
        + '<div class="ed-actions"><button type="button" class="ed-review" id="edReview">Переглянути детальний розбір →</button></div>';
      dialogBack.classList.add("on");
      dialog.querySelector("#edReview").addEventListener("click", function(){
        dialogBack.classList.remove("on");
        var res = document.querySelector(cfg.resultSelector);
        if(res && res.scrollIntoView) res.scrollIntoView({behavior:"smooth"});
      });
    }

    /* ---------- Повний екран ---------- */
    function toggleFull(){
      try{
        if(!document.fullscreenElement){ (document.documentElement.requestFullscreen||function(){})(); }
        else { (document.exitFullscreen||function(){})(); }
      }catch(e){}
    }

    /* ---------- утиліти ---------- */
    function el(tag, cls){ var e=document.createElement(tag); if(cls) e.className=cls; return e; }
    function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  }

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
