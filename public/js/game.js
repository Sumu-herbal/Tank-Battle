/**
 * 坦克大战 - 主游戏逻辑（公网版）
 * 适配新版 Network 类：自动连接 / 自动重连 / WSS自适应
 */

window.onerror = function(msg, url, line) {
  console.error('💥 游戏崩溃:', msg, '行:', line);
  const el = document.getElementById('errorInfo');
  if (el) { el.textContent = '错误: ' + msg + ' (行' + line + ')'; el.style.display = 'block'; }
  return false;
};

const Game = {
  running: false,
  gameState: null,
  localPlayerId: null,
  localPlayerName: '???',
  lastShootTime: 0,
  shootCooldown: 500,
  net: null, // window.network 引用

  predictedX: undefined,
  predictedY: undefined,
  predictedDir: 0,
  pendingMove: -1,
  _smoothDir: 0,       // 视觉方向插值
  _predVx: 0, _predVy: 0, // 速度动量

  fx: null,           // ParticleSystem 实例
  screenShake: 0,
  orbitalMarkers: [],
  sandstormAlpha: 0,

  init() {
    try {
      Input.init();
      Audio.init();
      Renderer.init();
      this.fx = new ParticleSystem();

      // 预加载素材，就绪后自动开始
      Sprites.preload().then(() => {
        const s = document.getElementById('connectStatus');
        if (s) s.textContent = '素材就绪，等待连接...';
      });

      // 绑定网络对象
      this.net = window.network;
      if (!this.net) {
        console.error('network.js 未加载');
        return;
      }

      // 设置消息处理器（带缓冲，不丢消息）
      this.net.setHandler((msg) => this._dispatch(msg));

      // 监听网络状态变化
      window.addEventListener('netstate', (e) => this._onNetState(e.detail));

      // 菜单直接进入游戏
      const $ = (id) => document.getElementById(id);

      // 点击加入按钮 → 全屏 + 横屏锁定
      const btnJoin = $('btnJoin');
      if (btnJoin) btnJoin.addEventListener('click', () => this._requestFullscreen().then(() => this.startGame()));

      // 回车也可以
      const serverAddr = $('serverAddr');
      if (serverAddr) {
        serverAddr.value = window.location.hostname + ':3000';
        serverAddr.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') this._requestFullscreen().then(() => this.startGame());
        });
      }

      const btnRestart = $('btnRestart');
      if (btnRestart) btnRestart.addEventListener('click', () => location.reload());

      // 聊天
      const chatInput = $('chatInput');
      if (chatInput) {
        chatInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            if (chatInput.value.trim()) {
              this.net.send({ type: 'chat', message: chatInput.value.trim().substring(0, 100) });
              chatInput.value = '';
            }
          }
        });
      }

      // 画布大小响应窗口/方向变化
      window.addEventListener('resize', () => this._onResize());
      window.addEventListener('orientationchange', () => {
        setTimeout(() => this._onResize(), 300); // 等方向变化完成
      });

      // 自动开始
      this.startGame();
    } catch(e) {
      console.error('Game.init 失败:', e);
    }
  },

  // ===== 全屏 + 横屏锁定 =====
  async _requestFullscreen() {
    try {
      // 尝试全屏
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
    } catch(e) { /* 静默失败，有些浏览器不支持 */ }
    // 尝试锁定横屏
    try {
      if (screen.orientation && screen.orientation.lock) {
        await screen.orientation.lock('landscape');
      }
    } catch(e) { /* 不支持 orientation.lock，用 CSS fallback */ }
  },

  // ===== Canvas 尺寸响应 =====
  _onResize() {
    Renderer.resize();
  },

  // ===== 网络状态 UI =====
  _onNetState(state) {
    const banner = document.getElementById('reconnectBanner');
    if (!banner) return;
    switch (state) {
      case 'reconnecting':
        banner.style.display = 'flex';
        banner.textContent = '🔄 重连中...';
        banner.style.background = 'rgba(255,180,0,0.85)';
        break;
      case 'connected':
        banner.style.display = 'none';
        this.net._resetBackoff();
        break;
      case 'disconnected':
        banner.style.display = 'flex';
        banner.textContent = '❌ 连接断开，正在重连...';
        banner.style.background = 'rgba(255,50,50,0.85)';
        break;
      case 'connecting':
        banner.style.display = 'flex';
        banner.textContent = '🔗 连接服务器...';
        banner.style.background = 'rgba(100,140,255,0.85)';
        break;
    }
  },

  startGame() {
    // 读取玩家自定义名字
    const nameInput = document.getElementById('playerName');
    const customName = nameInput ? nameInput.value.trim() : '';
    if (customName) {
      this.localPlayerName = customName.substring(0, 8);
      // 把名字发送给服务器
      if (this.net) this.net.send({ type: 'setName', name: this.localPlayerName });
    }

    Audio.play('menu');
    const menu = document.getElementById('menu');
    const gs = document.getElementById('gameScreen');
    if (menu) menu.classList.add('hidden');
    if (gs) gs.classList.remove('hidden');
    Renderer.resize();

    if (!this.running) {
      this.running = true;
      this.lastTime = performance.now();
      requestAnimationFrame((t) => this.gameLoop(t));
    }
  },

  // ===== 消息分发 =====
  _dispatch(msg) {
    switch (msg.type) {
      case 'init':
        this.localPlayerId = msg.playerId;
        this.localPlayerName = msg.playerName || '???';
        this.predictedX = undefined;
        this.predictedY = undefined;
        // 保存会话到 sessionStorage（支持页面刷新恢复）
        if (msg.sessionToken) {
          this.net._saveSession(msg.playerId, msg.sessionToken);
        }
        this.net._setState('connected');
        this.net._resetBackoff();
        if (msg.reconnect) {
          this.addChatMessage('📢', `🔄 重连成功！欢迎回来 ${this.localPlayerName}`);
          // 关闭死亡遮罩
          const deathEl = document.getElementById('deathOverlay');
          if (deathEl) deathEl.classList.add('hidden');
        } else {
          this.addChatMessage('📢', `欢迎 ${this.localPlayerName}！`);
        }
        const statusEl = document.getElementById('connectStatus');
        if (statusEl) { statusEl.textContent = `✅ 已连接 · ${this.localPlayerName}`; statusEl.style.color = '#3fe8a0'; }
        console.log('🎯', this.localPlayerName, this.localPlayerId);
        break;

      case 'hydrate':
        // 完整状态快照（重连后恢复）
        try {
          this.gameState = msg.data;
          this.predictedX = undefined; this.predictedY = undefined;
          this._predVx = 0; this._predVy = 0;
          this.updateHud();
          console.log('💾 状态已恢复');
        } catch(e) { console.error('hydrate:', e); }
        break;

      case 'gameState':
        try {
          if (this.gameState) this.detectChanges(this.gameState, msg.data);
          this.gameState = msg.data;
          this.reconcilePrediction(msg.data);
          this.updateHud();
        } catch(e) { console.error('stateUpdate:', e); }
        break;

      case 'playerJoined':
        this.addChatMessage('📢', `${msg.playerName||'玩家'} 加入 · ${msg.playerCount}人在线`);
        break;

      case 'playerDisconnected':
        this.addChatMessage('📢', `${msg.playerName||'玩家'} 断线`);
        break;

      case 'playerReconnected':
        this.addChatMessage('📢', `${msg.playerName||'玩家'} 重连`);
        // 移除该玩家的断线标记
        if (this.gameState && this.gameState.players && this.gameState.players[msg.playerId]) {
          this.gameState.players[msg.playerId].disconnectedAt = 0;
        }
        break;

      case 'playerLeft':
        this.addChatMessage('📢', `${msg.playerName||'玩家'} 离开 · ${msg.playerCount}人在线`);
        break;

      case 'newWave':
        Audio.play('wave');
        this.addChatMessage('📢', `第 ${msg.wave} 波！`);
        break;

      case 'chat':
        if (msg.isSystem) {
          this.addChatMessage('📢', msg.message);
        } else {
          const n = (msg.playerId === this.localPlayerId)
            ? `我(${this.localPlayerName})`
            : (msg.playerName || (msg.playerId||'').substring(0,8));
          this.addChatMessage(n, msg.message);
        }
        break;

      case 'error':
        // 重连失败时清除会话，让用户可以重新加入
        if (msg.message && msg.message.includes('重连失败')) {
          this.net._clearSession();
        }
        alert('服务器: ' + msg.message);
        break;

      case 'battleEvent':
        this.addChatMessage('⚡', '战场事件: ' + (msg.event||''));
        if (msg.event === 'orbital_strike') {
          this.orbitalMarkers = (msg.targets||[]).map(t => ({ x:t.x, y:t.y, timer:120 }));
        }
        if (msg.event === 'sandstorm') this.sandstormAlpha = 0.4;
        break;

      case 'eventEnd':
        this.addChatMessage('📢', '事件结束');
        this.sandstormAlpha = 0;
        this.orbitalMarkers = [];
        break;

      case 'killFeed':
        this.addKillFeed(msg.killer, msg.victim);
        break;
    }
  },

  // ===== 客户端预测（带速度动量，更流畅） =====
  reconcilePrediction(state) {
    const lp = state.players[this.localPlayerId];
    if (!lp || !lp.alive) {
      this.predictedX = undefined; this.predictedY = undefined;
      this._predVx = 0; this._predVy = 0;
      return;
    }
    if (this.predictedX == null || isNaN(this.predictedX)) {
      this.predictedX = lp.x; this.predictedY = lp.y; this.predictedDir = lp.dir;
      this._predVx = 0; this._predVy = 0;
      return;
    }
    if (this.pendingMove >= 0) {
      const dx = lp.x - this.predictedX, dy = lp.y - this.predictedY;
      const dist = Math.sqrt(dx*dx + dy*dy);
      // 偏差大 → 硬切（阈值缩小，减少跳变感）
      if (dist > TILE_SIZE * 0.4) {
        this.predictedX += dx * 0.55; // 更大的 lerp 因子
        this.predictedY += dy * 0.55;
      } else if (dist > 0.5) {
        // 小偏差 → 平滑逼近
        this.predictedX += dx * 0.4;
        this.predictedY += dy * 0.4;
      }
      // 记录速度动量
      this._predVx = dx * 0.1;
      this._predVy = dy * 0.1;
    } else if (this._predVx || this._predVy) {
      // 静止时衰减剩余动量（惯性感）
      this._predVx *= 0.8;
      this._predVy *= 0.8;
      if (Math.abs(this._predVx) < 0.05) this._predVx = 0;
      if (Math.abs(this._predVy) < 0.05) this._predVy = 0;
    }
    this.predictedDir = lp.dir;
  },

  // ===== 状态变化检测 =====
  detectChanges(old, now) {
    // 敌人死亡检测 — 用 Map 做 O(1) 查找
    if (old.enemies && now.enemies) {
      const nowMap = new Map();
      for (const ne of now.enemies) { if (ne.alive) nowMap.set(ne.id, ne); }
      for (const oe of old.enemies) {
        if (!oe.alive) continue;
        if (!nowMap.has(oe.id)) {
          this._explosion(oe.x, oe.y, 20); Audio.play('explosion');
        }
      }
    }
    if (old.players && now.players) {
      for (const pid in old.players) {
        const op = old.players[pid], np = now.players[pid];
        if (!op || !np) continue;
        if (op.alive && !np.alive) {
          this._explosion(op.x, op.y, 30);
          if (pid === this.localPlayerId) {
            Audio.play('death');
            const el = document.getElementById('deathOverlay');
            if (el) el.classList.remove('hidden');
            this.predictedX = undefined; this.predictedY = undefined;
          }
          this.screenShake = 8;
        }
        if (!op.alive && np.alive && pid === this.localPlayerId) {
          const el = document.getElementById('deathOverlay');
          if (el) el.classList.add('hidden');
        }
      }
    }
    if (old.powerups && now.powerups && now.powerups.length < old.powerups.length) Audio.play('powerup');
    // wave 变化由 newWave 消息单独处理，这里不重复播放音效
    if (old.bullets && now.bullets && now.bullets.length < old.bullets.length) Audio.play('hit');
    if (old.baseAlive && !now.baseAlive) {
      this._explosion(MAP_COLS/2*TILE_SIZE, (MAP_ROWS-2)*TILE_SIZE, 60);
      Audio.play('explosion'); this.screenShake = 16;
      const el = document.getElementById('gameOverOverlay'); if (el) el.classList.remove('hidden');
    }
  },

  _explosion(x, y, n) {
    if (isNaN(x) || isNaN(y) || !this.fx) return;
    this.fx.explode(x, y, n);
    if (n > 15) this.fx.debris(x, y, 6);
    if (n > 10) this.fx.smoke(x, y, 3);
    if (n > 5) this.fx.spark(x, y, 0, 4);
  },

  addChatMessage(s, t) {
    const c = document.getElementById('chatMessages'); if (!c) return;
    const d = document.createElement('div'); d.className='msg';
    d.innerHTML = `<b>${s}</b> ${t}`; c.appendChild(d);
    c.scrollTop = c.scrollHeight;
    while (c.children.length > 20 && c.firstChild) c.firstChild.remove();
  },

  // 击杀播报
  addKillFeed(killer, victim) {
    const feed = document.getElementById('killFeed');
    if (!feed) {
      const f = document.createElement('div'); f.id = 'killFeed';
      document.getElementById('gameScreen')?.appendChild(f);
    }
    const el = document.getElementById('killFeed');
    if (!el) return;
    const d = document.createElement('div'); d.className = 'kill-line';
    d.textContent = `${killer || '???'} 击毁 ${victim || '???'}`;
    el.appendChild(d);
    setTimeout(() => d.remove(), 2700);
    while (el.children.length > 5 && el.firstChild) el.firstChild.remove();
  },

  // ===== HUD =====
  updateHud() {
    const s = this.gameState; if (!s) return;
    const $ = id => document.getElementById(id);
    const pc = Object.keys(s.players).length;
    if ($('hudWave')) $('hudWave').textContent = `W${s.wave}`;
    if ($('hudEnemies')) $('hudEnemies').textContent = `👥${pc} 🎯${s.enemiesRemaining}`;
    if ($('hudBase')) {
      $('hudBase').textContent = s.baseAlive ? `🏠 ${this.localPlayerName}` : '💀 BASE';
      $('hudBase').className = s.baseAlive ? 'base-ok' : 'base-danger';
    }
    const lp = s.players[this.localPlayerId];
    if (lp) {
      if ($('hudScore')) $('hudScore').textContent = `💯${lp.score}`;
      if ($('hudKills')) $('hudKills').textContent = `💀${lp.kills}`;
      if ($('hudGold')) $('hudGold').textContent = `🪙${lp.gold||0}`;
      // 血条
      const hf = $('hudHealthFill');
      if (hf) { const pct = lp.maxHp ? Math.max(0, (lp.hp||0) / lp.maxHp * 100) : 100; hf.style.width = pct + '%'; }
      if (lp.shieldActive && lp.shieldTimer>0) {
        if ($('puActive')) $('puActive').textContent = '🛡️ 护盾';
        if ($('puTimer')) $('puTimer').textContent = (lp.shieldTimer/1000).toFixed(1)+'s';
      } else if (lp.rapidFire && lp.rapidFireTimer>0) {
        if ($('puActive')) $('puActive').textContent = '⚡ 速射';
        if ($('puTimer')) $('puTimer').textContent = (lp.rapidFireTimer/1000).toFixed(1)+'s';
      } else {
        if ($('puActive')) $('puActive').textContent = '道具就绪';
        if ($('puTimer')) $('puTimer').textContent = '';
      }
      if (lp.alive) { const el = $('deathOverlay'); if (el) el.classList.add('hidden'); }
    }
    if (s.gameOver) {
      const o = $('gameOverOverlay'), t = $('gameOverText');
      if (o) o.classList.remove('hidden');
      if (t) { t.textContent = s.baseAlive?'VICTORY!':'GAME OVER'; t.className = s.baseAlive?'win':'lose'; }
    }
    this._scoreboard(s);
  },

  _scoreboard(s) {
    const sb = document.getElementById('sbList'); if (!sb) return;
    // 节流：每 500ms 或分数排序变化时才更新 DOM
    const now = performance.now();
    const ps = Object.values(s.players).sort((a,b)=>b.score-a.score);
    // 生成轻量指纹（Top3 的 id+score）
    const fp = ps.slice(0,3).map(p=>p.id+':'+p.score).join('|');
    if (fp === this._sbFingerprint && now - (this._sbLastTime||0) < 500) return;
    this._sbFingerprint = fp;
    this._sbLastTime = now;
    try {
      if (!ps.length) { sb.innerHTML = '<div class="sb-row">等待中...</div>'; return; }
      let html = '';
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        const me = p.id === this.localPlayerId ? ' me' : '';
        const medal = ['👑','🥈','🥉'][i] || (i + 1);
        html += `<div class="sb-row${me}"><span class="sb-name">${medal} ${p.name||'???'}</span><span class="sb-score">${p.score}</span></div>`;
      }
      sb.innerHTML = html;
    } catch(e){}
  },

  // ===== 游戏循环 =====
  gameLoop(ts) {
    if (!this.running) return;
    try {
      this.lastTime = this.lastTime || ts;
      const dt = Math.min(ts - this.lastTime, 50);
      this.lastTime = ts;
      this.processInput();
      this._updateSmoothDir(dt);
      this.updateEffects(dt);
      this.render();
    } catch(e) { console.error('loop:', e); }
    requestAnimationFrame(t => this.gameLoop(t));
  },

  // 方向平滑插值（避免瞬间旋转）
  _updateSmoothDir(dt) {
    if (this.predictedX == null) { this._smoothDir = this.predictedDir || 0; return; }
    let diff = this.predictedDir - this._smoothDir;
    // 处理方向环绕（0↔3）
    if (diff > 2) diff -= 4;
    if (diff < -2) diff += 4;
    this._smoothDir += diff * Math.min(1, (dt || 16) * 0.012);
    // 归一化到 [0, 4)
    this._smoothDir = ((this._smoothDir % 4) + 4) % 4;
  },

  processInput() {
    if (!this.gameState) return;
    const lp = this.gameState.players[this.localPlayerId];
    if (!lp || !lp.alive) { this.pendingMove = -1; return; }

    if (this.predictedX == null || isNaN(this.predictedX)) {
      this.predictedX = lp.x; this.predictedY = lp.y; this.predictedDir = lp.dir;
    }

    const dir = Input.getP1Move();
    const spd = TANK_SPEED + (lp.speedBoost||0);

    if (dir >= 0) {
      let nx = this.predictedX, ny = this.predictedY;
      switch (dir) {
        case DIR.UP: ny -= spd; break; case DIR.DOWN: ny += spd; break;
        case DIR.LEFT: nx -= spd; break; case DIR.RIGHT: nx += spd; break;
      }
      if (this._localCollide(nx, ny)) {
        this.predictedX = nx; this.predictedY = ny; this.predictedDir = dir;
      }
      // 只在方向变化时发送移动消息，减少网络负载
      if (dir !== this._lastSentDir) {
        this.net.send({ type: 'move', dir });
        this._lastSentDir = dir;
      }
      this.pendingMove = dir;
    } else if (this._lastSentDir !== -1) {
      // 松开按键时发送一次停止
      this.net.send({ type: 'move', dir: -1 });
      this._lastSentDir = -1;
      this.pendingMove = -1;
    }

    // 射击（键盘 Space/J + 触摸，频率限制）
    const now = performance.now();
    const cd = lp.rapidFire ? 180 : this.shootCooldown;
    if (now - this.lastShootTime > cd && (Input.isP1Shooting() || Input.getP1Shoot())) {
      this.lastShootTime = now;
      this.net.send({ type: 'shoot' });
      Audio.play('shoot');
    }

    // 技能键 K（键盘 + 触摸，频率限制 500ms）
    if (Input.getP1Powerup() && now - (this._lastSkillTime||0) > 500) {
      this._lastSkillTime = now;
      this.net.send({ type: 'skill' });
    }

    if (Input.wasPressed('enter') || Input.wasPressed('t')) {
      const ci = document.getElementById('chatInput'); if (ci) ci.focus();
    }
    Input.update();
  },

  _localCollide(nx, ny) {
    if (!this.gameState || !this.gameState.map || isNaN(nx) || isNaN(ny)) return false;
    const m = this.gameState.map, hs = TILE_SIZE/2 - 2;
    // 展开四角检测，避免每帧创建数组
    const corners = [
      nx - hs, ny - hs,  nx + hs, ny - hs,
      nx - hs, ny + hs,  nx + hs, ny + hs,
    ];
    for (let i = 0; i < 8; i += 2) {
      const col = Math.floor(corners[i] / TILE_SIZE), row = Math.floor(corners[i + 1] / TILE_SIZE);
      if (row < 0 || row >= MAP_ROWS || col < 0 || col >= MAP_COLS) return false;
      const rd = m[row]; if (!rd) return false;
      const t = rd[col];
      if (t === TILE.BRICK || t === TILE.STEEL || t === TILE.WATER || t === TILE.BASE) return false;
    }
    return true;
  },

  updateEffects(dt) {
    if (this.fx) this.fx.update();
    if (this.screenShake > 0) this.screenShake = Math.max(0, this.screenShake - (dt||16)*0.12);
  },

  render() {
    if (!this.gameState) {
      Renderer.clear();
      const ctx = Renderer.ctx; if (!ctx) return;
      ctx.fillStyle = '#555'; ctx.font = '16px Orbitron,monospace'; ctx.textAlign = 'center';
      ctx.fillText('连接服务器中...', Renderer.gameWidth/2, Renderer.gameHeight/2);
      return;
    }
    try {
      // 浅拷贝 + 局部深拷贝 players，避免昂贵的 JSON 序列化
      const rs = {
        ...this.gameState,
        players: { ...this.gameState.players },
        enemies: this.gameState.enemies,
        bullets: this.gameState.bullets,
        powerups: this.gameState.powerups,
        map: this.gameState.map,
      };
      if (this.predictedX!=null && !isNaN(this.predictedX) && rs.players[this.localPlayerId]) {
        const lp = rs.players[this.localPlayerId];
        rs.players[this.localPlayerId] = { ...lp, x: this.predictedX, y: this.predictedY, dir: this._smoothDir };
      }
      const sx = this.screenShake*(Math.random()*2-1), sy = this.screenShake*(Math.random()*2-1);
      Renderer.ctx.save();
      if (this.screenShake>0.5) Renderer.ctx.translate(sx, sy);
      Renderer.render(rs, this.localPlayerId);
      // 粒子系统 + 沙尘暴
      if (this.fx) this.fx.render(Renderer.ctx);
      if (this.sandstormAlpha > 0) {
        Renderer.ctx.fillStyle = `rgba(180,160,120,${this.sandstormAlpha})`;
        Renderer.ctx.fillRect(0, 0, Renderer.gameWidth, Renderer.gameHeight);
      }
      Renderer.ctx.restore();
    } catch(e) { console.error('render:', e); }
  }
};

// ===== 启动 =====
document.addEventListener('DOMContentLoaded', () => {
  try { Game.init(); console.log('🎮 坦克大战公网版就绪'); }
  catch(e) { console.error('启动失败:', e); }
});
