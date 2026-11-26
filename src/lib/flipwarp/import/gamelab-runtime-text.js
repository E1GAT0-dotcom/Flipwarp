// The blocks every translated Game Lab program gets, written as Flipwarp text:
// Game Lab's drawing (background, rect, ellipse, line, text) done with the pen,
// its sprites kept in lists and stamped, and its collisions worked out from
// each sprite's box, as Game Lab does. gamelab.js writes the program's own
// code in the same text and puts these after it.

// The lists that hold Game Lab's sprites, one item a sprite: ident -> Scratch name.
export const SPRITE_LISTS = {
    sx: 'sprite x', sy: 'sprite y', svx: 'sprite velocityX', svy: 'sprite velocityY', srot: 'sprite rotation',
    srs: 'sprite rotationSpeed', sscale: 'sprite scale', svis: 'sprite visible', sw: 'sprite width',
    sh: 'sprite height', sanim: 'sprite animation', salive: 'sprite alive', slife: 'sprite lifetime',
    sdepth: 'sprite depth', scolor: 'sprite color', srtd: 'sprite rotateToDirection', smirror: 'sprite mirrorX',
    sbounce: 'sprite bounciness'
};
export const OTHER_LISTS = {
    allSprites: 'allSprites', fwOrder: 'fw drawing order', animNames: 'animation names', animW: 'animation widths',
    animH: 'animation heights', fwFont: 'fw font', colorNames: 'color names', colorValues: 'color values'
};
// Variables the blocks below use: ident -> Scratch name.
export const RUNTIME_VARS = {
    fwX: 'fw x', fwCostume: 'fw costume', fwY: 'fw y', fwZoom: 'fw zoom', fwHit: 'fw hit', fwA: 'fw angle', fwColor: 'fw color',
    fwCharBase: 'fw char base', fwDepthDirty: 'fw depth changed', newSprite: 'new sprite', frameCount: 'frameCount',
    fillColor: 'fill color', fillAlpha: 'fill alpha', fillOn: 'fill on', strokeColor: 'stroke color',
    strokeAlpha: 'stroke alpha', strokeOn: 'stroke on', strokeWeight: 'stroke weight', textSize: 'text size',
    textAlignH: 'text align', textAlignV: 'text baseline', rectCenter: 'rect mode center',
    ellipseCenter: 'ellipse mode center', camX: 'camera x', camY: 'camera y', camZoom: 'camera zoom',
    camOn: 'camera on',
    rfN: 'fw rect n', rfT: 'fw rect t', rfI: 'fw rect i', rcX: 'fw rect x', rcY: 'fw rect y',
    efN: 'fw ellipse n', efT: 'fw ellipse t', efI: 'fw ellipse i', efDY: 'fw ellipse dy', efHW: 'fw ellipse hw',
    ecX: 'fw ellipse x', ecY: 'fw ellipse y',
    txPx: 'fw text pixel', txLen: 'fw text length', txX: 'fw text x', txY: 'fw text y', txI: 'fw text i',
    txC: 'fw text char', txK: 'fw text glyph', txBits: 'fw text bits', txR: 'fw text row', txQ: 'fw text column',
    dsA: 'fw draw animation', dI: 'fw draw i', dJ: 'fw draw sprite', sdI: 'fw sort i', sdJ: 'fw sort j',
    sdK: 'fw sort k', saK: 'fw animation k', upI: 'fw update i',
    tcAW: 'fw touch aw', tcAH: 'fw touch ah', tcBW: 'fw touch bw', tcBH: 'fw touch bh', tcDX: 'fw touch dx',
    tcDY: 'fw touch dy', tcOX: 'fw touch ox', tcOY: 'fw touch oy', clK: 'fw color k'
};

// A costume chosen by a name worked out as the game runs: the text cannot put a
// value in a dropdown in every version of Flipwarp, so it names this one and
// gamelab.js points the dropdown at the "fw costume" variable afterwards.
export const COSTUME_BY_VARIABLE = '@fw costume';

export const RUNTIME_TEXT = `define fast fw_screen(p_x, p_y) as "fw screen x %s y %s" {
  if (camOn == 1) {
    fwX = (p_x - camX) * camZoom;
    fwY = (camY - p_y) * camZoom;
    fwZoom = camZoom;
  } else {
    fwX = p_x - 200;
    fwY = 200 - p_y;
    fwZoom = 1;
  }
}

define fast fw_pen(p_c, p_a) as "fw pen color %s alpha %s" {
  pen.setPenColorTo(p_c);
  pen.setPenTo("transparency", 100 - (p_a / 2.55));
}

define fast fw_line(p_x1, p_y1, p_x2, p_y2, p_size) as "fw line %s %s to %s %s size %s" {
  pen.penUp();
  fw_screen(p_x1, p_y1);
  pen.setPenSizeTo(p_size * fwZoom);
  goToXY(fwX, fwY);
  pen.penDown();
  fw_screen(p_x2, p_y2);
  goToXY(fwX, fwY);
  pen.penUp();
}

define fast fw_rectFill(p_x, p_y, p_w, p_h) as "fw fill rect %s %s %s %s" {
  if ((p_w > 0) && (p_h > 0)) {
    if (p_w > p_h) {
      rfN = mathOp("ceiling", p_h / 6);
      rfT = p_h / rfN;
      rfI = 0;
      repeat (rfN) {
        fw_line(p_x + (rfT / 2), p_y + ((rfI + 0.5) * rfT), (p_x + p_w) - (rfT / 2), p_y + ((rfI + 0.5) * rfT), rfT + 0.6);
        rfI += 1;
      }
      fw_line(p_x + (rfT / 2), p_y + (rfT / 2), p_x + (rfT / 2), (p_y + p_h) - (rfT / 2), rfT + 0.6);
      fw_line((p_x + p_w) - (rfT / 2), p_y + (rfT / 2), (p_x + p_w) - (rfT / 2), (p_y + p_h) - (rfT / 2), rfT + 0.6);
    } else {
      rfN = mathOp("ceiling", p_w / 6);
      rfT = p_w / rfN;
      rfI = 0;
      repeat (rfN) {
        fw_line(p_x + ((rfI + 0.5) * rfT), p_y + (rfT / 2), p_x + ((rfI + 0.5) * rfT), (p_y + p_h) - (rfT / 2), rfT + 0.6);
        rfI += 1;
      }
      fw_line(p_x + (rfT / 2), p_y + (rfT / 2), (p_x + p_w) - (rfT / 2), p_y + (rfT / 2), rfT + 0.6);
      fw_line(p_x + (rfT / 2), (p_y + p_h) - (rfT / 2), (p_x + p_w) - (rfT / 2), (p_y + p_h) - (rfT / 2), rfT + 0.6);
    }
  }
}

define fast fw_rect(p_x, p_y, p_w, p_h) as "fw rect %s %s %s %s" {
  rcX = p_x;
  rcY = p_y;
  if (rectCenter == 1) {
    rcX = p_x - (p_w / 2);
    rcY = p_y - (p_h / 2);
  }
  if (fillOn == 1) {
    fw_pen(fillColor, fillAlpha);
    fw_rectFill(rcX, rcY, p_w, p_h);
  }
  if (strokeOn == 1) {
    fw_pen(strokeColor, strokeAlpha);
    fw_line(rcX, rcY, rcX + p_w, rcY, strokeWeight);
    fw_line(rcX + p_w, rcY, rcX + p_w, rcY + p_h, strokeWeight);
    fw_line(rcX + p_w, rcY + p_h, rcX, rcY + p_h, strokeWeight);
    fw_line(rcX, rcY + p_h, rcX, rcY, strokeWeight);
  }
}

define fast fw_ellipse(p_x, p_y, p_w, p_h) as "fw ellipse %s %s %s %s" {
  ecX = p_x;
  ecY = p_y;
  if (ellipseCenter == 0) {
    ecX = p_x + (p_w / 2);
    ecY = p_y + (p_h / 2);
  }
  if (fillOn == 1) {
    fw_pen(fillColor, fillAlpha);
    if (mathOp("abs", p_w - p_h) < 1) {
      fw_line(ecX, ecY, ecX, ecY, p_w);
    } else {
      efN = mathOp("ceiling", p_h / 3);
      efT = p_h / efN;
      efI = 0;
      repeat (efN) {
        efDY = ((efI + 0.5) * efT) - (p_h / 2);
        efHW = (p_w / 2) * mathOp("sqrt", 1 - ((efDY / (p_h / 2)) * (efDY / (p_h / 2))));
        if (efHW > (efT / 2)) {
          fw_line((ecX - efHW) + (efT / 2), ecY + efDY, (ecX + efHW) - (efT / 2), ecY + efDY, efT + 0.6);
        } else {
          fw_line(ecX, ecY + efDY, ecX, ecY + efDY, efT);
        }
        efI += 1;
      }
    }
  }
  if (strokeOn == 1) {
    fw_pen(strokeColor, strokeAlpha);
    efI = 0;
    repeat (36) {
      fw_line(ecX + ((p_w / 2) * mathOp("cos", efI * 10)), ecY + ((p_h / 2) * mathOp("sin", efI * 10)), ecX + ((p_w / 2) * mathOp("cos", (efI + 1) * 10)), ecY + ((p_h / 2) * mathOp("sin", (efI + 1) * 10)), strokeWeight);
      efI += 1;
    }
  }
}

define fast fw_background(p_c) as "fw background %s" {
  pen.eraseAll();
  pen.penUp();
  pen.setPenColorTo(p_c);
  pen.setPenTo("transparency", 0);
  pen.setPenSizeTo(1000);
  goToXY(0, 0);
  pen.penDown();
  pen.penUp();
}

define fast fw_text(p_s, p_x, p_y) as "fw text %s at %s %s" {
  if (fillOn == 1) {
    fw_pen(fillColor, fillAlpha);
    txPx = textSize / 10;
    txLen = lengthOf(p_s);
    txX = p_x;
    if (textAlignH == "center") {
      txX = p_x - (((txLen * 6) - 1) * (txPx / 2));
    }
    if (textAlignH == "right") {
      txX = p_x - (((txLen * 6) - 1) * txPx);
    }
    txY = p_y - (7 * txPx);
    if (textAlignV == "top") {
      txY = p_y;
    }
    if (textAlignV == "center") {
      txY = p_y - (3.5 * txPx);
    }
    txI = 1;
    repeat (txLen) {
      txC = letterOf(txI, p_s);
      if (!(txC == " ")) {
        switchCostume("fw blank");
        fwCostume = join("~", txC);
        switchCostume("@fw costume");
        txK = costume("number") - fwCharBase;
        if (txK > 0) {
          txBits = itemOfList(fwFont, txK);
          txR = 0;
          repeat (7) {
            txQ = 0;
            repeat (5) {
              if (letterOf(((txR * 5) + txQ) + 1, txBits) == 1) {
                fw_line(txX + ((txQ + 0.5) * txPx), txY + ((txR + 0.5) * txPx), txX + ((txQ + 0.5) * txPx), txY + ((txR + 0.5) * txPx), txPx * 1.25);
              }
              txQ += 1;
            }
            txR += 1;
          }
        }
      }
      txX += 6 * txPx;
      txI += 1;
    }
  }
}

define fast fw_color(p_v) as "fw color of %s" {
  if (letterOf(1, p_v) == "#") {
    if (lengthOf(p_v) < 5) {
      fwColor = join("0x", join(join(join(letterOf(2, p_v), letterOf(2, p_v)), join(letterOf(3, p_v), letterOf(3, p_v))), join(letterOf(4, p_v), letterOf(4, p_v)))) + 0;
    } else {
      fwColor = join("0x", join(join(join(letterOf(2, p_v), letterOf(3, p_v)), join(letterOf(4, p_v), letterOf(5, p_v))), join(letterOf(6, p_v), letterOf(7, p_v)))) + 0;
    }
  } else {
    if ((p_v + 0) == p_v) {
      if (p_v < 256) {
        fwColor = round(p_v) * 65793;
      } else {
        fwColor = p_v;
      }
    } else {
      clK = itemNumberInList(colorNames, p_v);
      if (clK > 0) {
        fwColor = itemOfList(colorValues, clK);
      } else {
        fwColor = 0;
      }
    }
  }
}

define fast fw_create(p_x, p_y, p_w, p_h) as "fw create sprite %s %s %s %s" {
  addToList(sx, p_x);
  addToList(sy, p_y);
  addToList(svx, 0);
  addToList(svy, 0);
  addToList(srot, 0);
  addToList(srs, 0);
  addToList(sscale, 1);
  addToList(svis, 1);
  addToList(sw, p_w);
  addToList(sh, p_h);
  addToList(sanim, "");
  addToList(salive, 1);
  addToList(slife, -1);
  addToList(sdepth, lengthOfList(sx));
  addToList(scolor, itemOfList(colorValues, pickRandom(1, 6)));
  addToList(srtd, 0);
  addToList(smirror, 1);
  addToList(sbounce, 1);
  newSprite = lengthOfList(sx);
  addToList(allSprites, newSprite);
  addToList(fwOrder, newSprite);
}

define fast fw_setAnimation(p_i, p_name) as "fw set animation of %s to %s" {
  saK = itemNumberInList(animNames, p_name);
  if (saK > 0) {
    replaceInList(sanim, p_i, p_name);
    replaceInList(sw, p_i, itemOfList(animW, saK));
    replaceInList(sh, p_i, itemOfList(animH, saK));
  } else {
    replaceInList(sanim, p_i, "");
  }
}

define fast fw_atan2(p_y, p_x) as "fw atan2 %s %s" {
  if (p_x == 0) {
    if (p_y > 0) {
      fwA = 90;
    } else {
      if (p_y < 0) {
        fwA = -90;
      } else {
        fwA = 0;
      }
    }
  } else {
    fwA = mathOp("atan", p_y / p_x);
    if (p_x < 0) {
      if (p_y < 0) {
        fwA += -180;
      } else {
        fwA += 180;
      }
    }
  }
}

define fast fw_update() as "fw move sprites" {
  upI = 1;
  repeat (lengthOfList(sx)) {
    if (itemOfList(salive, upI) == 1) {
      replaceInList(sx, upI, itemOfList(sx, upI) + itemOfList(svx, upI));
      replaceInList(sy, upI, itemOfList(sy, upI) + itemOfList(svy, upI));
      replaceInList(srot, upI, itemOfList(srot, upI) + itemOfList(srs, upI));
      if ((itemOfList(srtd, upI) == 1) && !((itemOfList(svx, upI) == 0) && (itemOfList(svy, upI) == 0))) {
        fw_atan2(itemOfList(svy, upI), itemOfList(svx, upI));
        replaceInList(srot, upI, fwA);
      }
      if (itemOfList(slife, upI) > 0) {
        replaceInList(slife, upI, itemOfList(slife, upI) - 1);
        if (itemOfList(slife, upI) == 0) {
          fw_destroy(upI);
        }
      }
    }
    upI += 1;
  }
}

define fast fw_sortDepth() as "fw sort by depth" {
  sdI = 2;
  repeat (lengthOfList(fwOrder) - 1) {
    sdK = itemOfList(fwOrder, sdI);
    sdJ = sdI - 1;
    repeatUntil ((sdJ < 1) || !(itemOfList(sdepth, itemOfList(fwOrder, sdJ)) > itemOfList(sdepth, sdK))) {
      replaceInList(fwOrder, sdJ + 1, itemOfList(fwOrder, sdJ));
      sdJ += -1;
    }
    replaceInList(fwOrder, sdJ + 1, sdK);
    sdI += 1;
  }
  fwDepthDirty = 0;
}

define fast fw_drawSprite(p_i) as "fw draw sprite %s" {
  dsA = itemOfList(sanim, p_i);
  if (dsA == "") {
    fw_pen(itemOfList(scolor, p_i), 255);
    fw_rectFill(itemOfList(sx, p_i) - ((itemOfList(sw, p_i) * itemOfList(sscale, p_i)) / 2), itemOfList(sy, p_i) - ((itemOfList(sh, p_i) * itemOfList(sscale, p_i)) / 2), itemOfList(sw, p_i) * itemOfList(sscale, p_i), itemOfList(sh, p_i) * itemOfList(sscale, p_i));
  } else {
    fw_screen(itemOfList(sx, p_i), itemOfList(sy, p_i));
    fwCostume = dsA;
    switchCostume("@fw costume");
    goToXY(fwX, fwY);
    setSize((itemOfList(sscale, p_i) * 100) * fwZoom);
    if (itemOfList(smirror, p_i) < 0) {
      setRotationStyle("left-right");
      pointInDirection(-90);
    } else {
      setRotationStyle("all around");
      pointInDirection(90 + itemOfList(srot, p_i));
    }
    pen.stamp();
  }
}

define fast fw_drawSprites() as "fw draw sprites" {
  if (fwDepthDirty == 1) {
    fw_sortDepth();
  }
  dI = 1;
  repeat (lengthOfList(fwOrder)) {
    dJ = itemOfList(fwOrder, dI);
    if ((itemOfList(salive, dJ) == 1) && (itemOfList(svis, dJ) == 1)) {
      fw_drawSprite(dJ);
    }
    dI += 1;
  }
}

define fast fw_touch(p_a, p_b, p_kind) as "fw touch %s %s %s" {
  fwHit = 0;
  if (!(p_a == p_b) && ((itemOfList(salive, p_a) == 1) && (itemOfList(salive, p_b) == 1))) {
    tcAW = mathOp("abs", itemOfList(sw, p_a) * itemOfList(sscale, p_a)) / 2;
    tcAH = mathOp("abs", itemOfList(sh, p_a) * itemOfList(sscale, p_a)) / 2;
    tcBW = mathOp("abs", itemOfList(sw, p_b) * itemOfList(sscale, p_b)) / 2;
    tcBH = mathOp("abs", itemOfList(sh, p_b) * itemOfList(sscale, p_b)) / 2;
    tcDX = itemOfList(sx, p_a) - itemOfList(sx, p_b);
    tcDY = itemOfList(sy, p_a) - itemOfList(sy, p_b);
    tcOX = (tcAW + tcBW) - mathOp("abs", tcDX);
    tcOY = (tcAH + tcBH) - mathOp("abs", tcDY);
    if ((tcOX > 0) && (tcOY > 0)) {
      fwHit = 1;
      if (!(p_kind == "overlap")) {
        if (tcOX < tcOY) {
          if (tcDX < 0) {
            tcOX = 0 - tcOX;
          }
          if (p_kind == "displace") {
            replaceInList(sx, p_b, itemOfList(sx, p_b) - tcOX);
          } else {
            replaceInList(sx, p_a, itemOfList(sx, p_a) + tcOX);
            if ((itemOfList(svx, p_a) * tcOX) < 0) {
              if (p_kind == "bounce") {
                replaceInList(svx, p_a, 0 - (itemOfList(svx, p_a) * itemOfList(sbounce, p_a)));
              } else {
                replaceInList(svx, p_a, 0);
              }
            }
          }
        } else {
          if (tcDY < 0) {
            tcOY = 0 - tcOY;
          }
          if (p_kind == "displace") {
            replaceInList(sy, p_b, itemOfList(sy, p_b) - tcOY);
          } else {
            replaceInList(sy, p_a, itemOfList(sy, p_a) + tcOY);
            if ((itemOfList(svy, p_a) * tcOY) < 0) {
              if (p_kind == "bounce") {
                replaceInList(svy, p_a, 0 - (itemOfList(svy, p_a) * itemOfList(sbounce, p_a)));
              } else {
                replaceInList(svy, p_a, 0);
              }
            }
          }
        }
      }
    }
  }
}

define fast fw_mouseOver(p_a) as "fw mouse over %s" {
  fwHit = 0;
  if (itemOfList(salive, p_a) == 1) {
    if ((mathOp("abs", (mouseX() + 200) - itemOfList(sx, p_a)) < (mathOp("abs", itemOfList(sw, p_a) * itemOfList(sscale, p_a)) / 2)) && (mathOp("abs", (200 - mouseY()) - itemOfList(sy, p_a)) < (mathOp("abs", itemOfList(sh, p_a) * itemOfList(sscale, p_a)) / 2))) {
      fwHit = 1;
    }
  }
}
`;

// Some of the colour names Game Lab understands.
export const COLOR_NAMES = {
    black: 0x000000, white: 0xffffff, red: 0xff0000, green: 0x008000, blue: 0x0000ff, yellow: 0xffff00,
    orange: 0xffa500, purple: 0x800080, pink: 0xffc0cb, brown: 0xa52a2a, gray: 0x808080, grey: 0x808080,
    cyan: 0x00ffff, magenta: 0xff00ff, lime: 0x00ff00, navy: 0x000080, teal: 0x008080, maroon: 0x800000,
    olive: 0x808000, silver: 0xc0c0c0, gold: 0xffd700, violet: 0xee82ee, indigo: 0x4b0082, skyblue: 0x87ceeb,
    lightblue: 0xadd8e6, darkblue: 0x00008b, lightgreen: 0x90ee90, darkgreen: 0x006400, lightgray: 0xd3d3d3,
    lightgrey: 0xd3d3d3, darkgray: 0xa9a9a9, darkgrey: 0xa9a9a9, beige: 0xf5f5dc, tan: 0xd2b48c, salmon: 0xfa8072,
    coral: 0xff7f50, tomato: 0xff6347, crimson: 0xdc143c, khaki: 0xf0e68c, turquoise: 0x40e0d0, aqua: 0x00ffff,
    fuchsia: 0xff00ff, lavender: 0xe6e6fa, plum: 0xdda0dd, orchid: 0xda70d6, chocolate: 0xd2691e,
    sienna: 0xa0522d, peru: 0xcd853f, wheat: 0xf5deb3, ivory: 0xfffff0, snow: 0xfffafa, mintcream: 0xf5fffa,
    forestgreen: 0x228b22, seagreen: 0x2e8b57, springgreen: 0x00ff7f, yellowgreen: 0x9acd32,
    royalblue: 0x4169e1, steelblue: 0x4682b4, dodgerblue: 0x1e90ff, deepskyblue: 0x00bfff, slategray: 0x708090,
    darkred: 0x8b0000, hotpink: 0xff69b4, deeppink: 0xff1493, darkorange: 0xff8c00, lightyellow: 0xffffe0,
    transparent: 0xffffff
};
