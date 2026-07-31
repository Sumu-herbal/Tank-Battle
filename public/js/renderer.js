/**
 * 坦克大战 - 全屏自适应 Canvas 渲染器
 */

const Renderer = {
  canvas: null,
  ctx: null,
  scale: 1,
  frameCount: 0,
  gameWidth: MAP_COLS * TILE_SIZE,
  gameHeight: MAP_ROWS * TILE_SIZE,
  _gridCache: null,     // 网格线离屏缓存
  _mapCache: null,      // 地图瓦片离屏缓存
  _mapHash: '',         // 地图内容哈希，用于增量更新
  _floatOffsets: null,  // 道具浮动预计算

  init() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx = this.canvas.getContext('2d');
    // 内部分辨率固定
    this.canvas.width = this.gameWidth;
    this.canvas.height = this.gameHeight;
    this.ctx.imageSmoothingEnabled = false; // 像素风清晰渲染
    this._buildGridCache();
    this._precomputeFloatOffsets();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  },

  // 预计算 256 帧的道具浮动偏移（避免每帧算 sin）
  _precomputeFloatOffsets() {
    this._floatOffsets = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      this._floatOffsets[i] = Math.sin(i * 0.08) * 2;
    }
  },

  // 获取当前帧的浮动偏移
  _floatAt(x) {
    return this._floatOffsets[(this.frameCount + (x * 31 | 0)) & 255];
  },

  // 网格线离屏缓存（完全静态）
  _buildGridCache() {
    const c = document.createElement('canvas');
    c.width = this.gameWidth; c.height = this.gameHeight;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 0.5;
    for (let r = 0; r <= MAP_ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * TILE_SIZE);
      ctx.lineTo(MAP_COLS * TILE_SIZE, r * TILE_SIZE);
      ctx.stroke();
    }
    for (let col = 0; col <= MAP_COLS; col++) {
      ctx.beginPath();
      ctx.moveTo(col * TILE_SIZE, 0);
      ctx.lineTo(col * TILE_SIZE, MAP_ROWS * TILE_SIZE);
      ctx.stroke();
    }
    this._gridCache = c;
  },

  resize() {
    const ww = window.innerWidth;
    const wh = window.innerHeight;
    const aspect = this.gameWidth / this.gameHeight;

    let cssW, cssH;
    if (ww / wh > aspect) {
      cssH = wh;
      cssW = wh * aspect;
    } else {
      cssW = ww;
      cssH = ww / aspect;
    }

    // 稍微放大让画面更有冲击力
    const fillFactor = 0.92;
    cssW = Math.min(ww * fillFactor, cssW * 1.05);
    cssH = Math.min(wh * fillFactor, cssH * 1.05);

    // 再按aspect修正
    if (cssW / cssH > aspect) {
      cssW = cssH * aspect;
    } else {
      cssH = cssW / aspect;
    }

    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.scale = cssW / this.gameWidth;
  },

  clear() {
    this.ctx.fillStyle = '#111111';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.frameCount++;
  },

  /**
   * 渲染完整游戏状态
   */
  render(gameState, localPlayerId) {
    this.clear();
    if (!gameState) return;

    this.drawMap(gameState.map);
    this.drawPowerups(gameState.powerups);
    this.drawBullets(gameState.bullets);
    this.drawEnemies(gameState.enemies);
    this.drawPlayers(gameState.players, localPlayerId);
    // 网格线用离屏缓存直绘（完全静态）
    if (this._gridCache) {
      this.ctx.drawImage(this._gridCache, 0, 0);
    }
  },

  // ========== 地图绘制（带缓存，只在瓦片变化时重绘） ==========
  drawMap(map) {
    if (!map) return;
    // 快速哈希：每行取首尾 + 中间采样
    let hash = '';
    for (let r = 0; r < MAP_ROWS; r++) {
      const row = map[r];
      hash += row ? (row[0]|0) + ',' + (row[MAP_COLS-1]|0) + ',' + (row[MAP_COLS>>1]|0) + ';' : '_;';
    }
    if (hash !== this._mapHash || !this._mapCache) {
      this._mapHash = hash;
      if (!this._mapCache) {
        this._mapCache = document.createElement('canvas');
        this._mapCache.width = this.gameWidth;
        this._mapCache.height = this.gameHeight;
      }
      const mctx = this._mapCache.getContext('2d');
      mctx.clearRect(0, 0, this.gameWidth, this.gameHeight);
      for (let row = 0; row < MAP_ROWS; row++) {
        for (let col = 0; col < MAP_COLS; col++) {
          const x = col * TILE_SIZE, y = row * TILE_SIZE;
          this._drawTileTo(mctx, x, y, map[row]?.[col], row, col);
        }
      }
    }
    this.ctx.drawImage(this._mapCache, 0, 0);
    // 叠加水域/基地动画
    this._drawMapOverlays(map);
  },

  // 静态瓦片绘制到指定上下文
  _drawTileTo(ctx, x, y, tile, row, col) {
    const sprite = Sprites.getTile(tile);
    if (sprite) {
      ctx.drawImage(sprite, x, y, TILE_SIZE, TILE_SIZE);
    } else {
      const colors = { [TILE.EMPTY]:'#111', [TILE.BRICK]:'#b5651d', [TILE.STEEL]:'#888',
        [TILE.WATER]:'#1a3a5c', [TILE.FOREST]:'#1a3a1a', [TILE.BASE]:'#333',
        [TILE.MUD]:'#3a2a14', [TILE.ICE]:'#1a3a5c', [TILE.TALL_GRASS]:'#0a2a0a' };
      ctx.fillStyle = colors[tile] || '#111';
      ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
    }
  },

  // 仅叠加动画层（水波/基地光晕）
  _drawMapOverlays(map) {
    const ctx = this.ctx;
    for (let row = 0; row < MAP_ROWS; row++) {
      for (let col = 0; col < MAP_COLS; col++) {
        const tile = map[row]?.[col];
        const x = col * TILE_SIZE, y = row * TILE_SIZE;
        if (tile === TILE.WATER) {
          ctx.fillStyle = `rgba(150,200,255,${0.1 + 0.05 * Math.sin(this.frameCount * 0.1 + row + col)})`;
          ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        } else if (tile === TILE.BASE) {
          const glow = 0.5 + 0.5 * Math.sin(this.frameCount * 0.05);
          ctx.fillStyle = `rgba(255, 215, 0, ${glow * 0.3})`;
          ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        }
      }
    }
  },

  // ========== 子弹绘制 ==========
  // ========== 子弹（贴图） ==========
  drawBullets(bullets) {
    if (!bullets) return;
    const ctx = this.ctx;
    for (const b of bullets) {
      const sprite = Sprites.getBullet(b.isPlayer);
      if (sprite) {
        ctx.drawImage(sprite, b.x - 4, b.y - 4, 8, 8);
      } else {
        ctx.fillStyle = b.isPlayer ? '#ff0' : '#f44';
        ctx.fillRect(b.x - 2, b.y - 2, 4, 4);
      }
    }
  },

  // ========== 坦克（贴图） ==========
  drawEnemies(enemies) {
    if (!enemies) return;
    const ctx = this.ctx;
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      this.drawTankSpr(enemy.x, enemy.y, enemy.dir, enemy.role, enemy.frozen, true, enemy.speed ? enemy.speed / TANK_SPEED : 1);
      const roleName = ROLE_NAMES[enemy.role] || enemy.role;
      ctx.font = '7px Orbitron, monospace'; ctx.textAlign = 'center';
      const tw = ctx.measureText(roleName).width + 4;
      ctx.fillStyle = 'rgba(255,0,0,0.6)';
      ctx.fillRect(enemy.x - tw/2, enemy.y - TILE_SIZE/2 - 14, tw, 9);
      ctx.fillStyle = '#fff'; ctx.fillText(roleName, enemy.x, enemy.y - TILE_SIZE/2 - 7);
    }
  },

  drawPlayers(players, localPlayerId) {
    if (!players) return;
    let idx = 0; const ctx = this.ctx;
    for (const pid in players) {
      const p = players[pid]; if (!p.alive) continue;
      const colorKey = pid === localPlayerId ? 'player1' : `player${(idx%8)+1}`;
      const spd = p.speed || TANK_SPEED;
      this.drawTankSpr(p.x, p.y, p.dir, colorKey, false, true, spd / TANK_SPEED);

      if (p.shieldActive) {
        ctx.strokeStyle = `rgba(255,215,0,${0.5+0.5*Math.sin(this.frameCount*0.2)})`;
        ctx.lineWidth=2; ctx.beginPath();
        ctx.arc(p.x, p.y, TILE_SIZE/2+2, 0, Math.PI*2); ctx.stroke();
      }
      const dn = p.name||`P${idx+1}`, isLocal = pid===localPlayerId;
      ctx.font = '8px Orbitron, monospace'; ctx.textAlign = 'center';
      const nw = ctx.measureText(dn).width + 6;
      ctx.fillStyle = isLocal ? 'rgba(0,255,0,0.7)' : 'rgba(255,255,255,0.5)';
      ctx.fillRect(p.x - nw/2, p.y - TILE_SIZE/2 - 16, nw, 10);
      ctx.fillStyle = '#000'; ctx.fillText(dn, p.x, p.y - TILE_SIZE/2 - 8);
      idx++;
    }
  },

  // dir2angle: 方向转弧度，支持浮点数平滑插值
  _dirToAngle(dir) {
    return dir * Math.PI / 2 - Math.PI / 2; // 0=UP(-π/2), 1=RIGHT(0), 2=DOWN(π/2), 3=LEFT(π)
  },

  drawTankSpr(x, y, dir, colorKey, frozen, isMoving = true, speed = 1) {
    const ctx = this.ctx;
    // 履带帧率关联速度：慢速3fps，标准6fps，快速12fps
    const treadSpeed = Math.max(1, Math.round(speed * 4));
    const frame = isMoving ? ((this.frameCount / treadSpeed) & 1) : 0;
    // 只取朝上帧，渲染时旋转（支持浮点角度平滑过渡）
    const sprite = Sprites.getTank(colorKey, frame);
    const s = Sprites.TANK_W;
    if (sprite) {
      ctx.save();
      ctx.translate(x, y);
      const angle = (typeof dir === 'number')
        ? this._dirToAngle(dir)     // 整数或浮点方向
        : this._dirToAngle(0);      // 兜底
      ctx.rotate(angle);
      ctx.drawImage(sprite, -s/2, -s/2, s, s);
      ctx.restore();
      if (frozen) {
        ctx.fillStyle = 'rgba(100,180,255,0.35)';
        ctx.fillRect(x - s/2, y - s/2, s, s);
      }
    } else {
      // 兜底方块
      ctx.fillStyle = frozen ? '#8cf' : TANK_COLORS[colorKey]?.body || '#0ef';
      ctx.fillRect(x - TILE_SIZE/2+2, y - TILE_SIZE/2+2, TILE_SIZE-4, TILE_SIZE-4);
    }
  },

  // ========== 道具绘制（使用预计算的浮动偏移） ==========
  drawPowerups(powerups) {
    if (!powerups) return;
    const ctx = this.ctx;
    const s = Sprites.POWERUP;
    const haloAlpha = 0.15 + 0.1 * this._floatOffsets[(this.frameCount * 3) & 255]; // ~0.06 rad
    for (const pu of powerups) {
      const flt = this._floatAt(pu.x);
      const sprite = Sprites.getPowerup(pu.type);

      // 光晕
      ctx.fillStyle = `rgba(255,255,255,${haloAlpha})`;
      ctx.fillRect(pu.x - s, pu.y - s + flt, s*2, s*2);

      if (sprite) {
        ctx.drawImage(sprite, pu.x - s/2, pu.y - s/2 + flt, s, s);
      } else {
        const def = POWERUP_TYPES[pu.type];
        ctx.fillStyle = def ? def.color : '#fff';
        ctx.fillRect(pu.x - s/2, pu.y - s/2 + flt, s, s);
        ctx.fillStyle = '#fff';
        ctx.font = `${s*0.6}px monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(def?.icon||'?', pu.x, pu.y + flt);
      }
    }
  },

  // ========== 特效 ==========
  spawnExplosion(x, y, size = 1) {
    // 爆炸粒子效果（调用方在外层管理）
    const ctx = this.ctx;
    const colors = ['#ff4444', '#ff8800', '#ffdd00', '#ffffff'];
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8;
      const dist = size * TILE_SIZE * (0.3 + Math.random() * 0.5);
      const px = x + Math.cos(angle) * dist;
      const py = y + Math.sin(angle) * dist;
      ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
      const sz = 2 + Math.random() * 4;
      ctx.fillRect(px - sz / 2, py - sz / 2, sz, sz);
    }
  }
};
