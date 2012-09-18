/*
 * Copyright (C) 2012 Klokan Technologies GmbH (info@klokantech.com)
 *
 * The JavaScript code in this page is free software: you can
 * redistribute it and/or modify it under the terms of the GNU
 * General Public License (GNU GPL) as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option)
 * any later version.  The code is distributed WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU GPL for more details.
 *
 * USE OF THIS CODE OR ANY PART OF IT IN A NONFREE SOFTWARE IS NOT ALLOWED
 * WITHOUT PRIOR WRITTEN PERMISSION FROM KLOKAN TECHNOLOGIES GMBH.
 *
 * As additional permission under GNU GPL version 3 section 7, you
 * may distribute non-source (e.g., minimized or compacted) forms of
 * that code without the copy of the GNU GPL normally required by
 * section 4, provided you include this license notice and a URL
 * through which recipients can access the Corresponding Source.
 *
 */

/**
 * @fileoverview Object representing single polygon + useful operations.
 *               The polygon can even be concave, the class calculates
 *               a triangulation of the polygon to be able to render it.
 *
 * @author petr.sloup@klokantech.com (Petr Sloup)
 *
 */

goog.provide('we.scene.Polygon');

goog.require('we.gl.Shader');
goog.require('we.scene.Drawable');
goog.require('we.shaderbank');



/**
 * @param {!we.gl.Context} context Context.
 * @constructor
 * @implements {we.scene.Drawable}
 */
we.scene.Polygon = function(context) {
  /**
   * @type {!we.gl.Context}
   */
  this.context = context;

  /**
   * @type {!WebGLRenderingContext}
   */
  this.gl = context.gl;
  var gl = this.gl;

  /**
   * @type {?we.scene.Polygon.Node}
   * @private
   */
  this.head_ = null;

  /**
   * @type {!Array.<!we.scene.Polygon.Node>}
   * @private
   */
  this.vertices_ = [];

  /**
   * @type {!WebGLBuffer}
   * @private
   */
  this.vertexBuffer_ = /** @type {!WebGLBuffer} */(gl.createBuffer());

  /**
   * @type {!WebGLBuffer}
   * @private
   */
  this.indexBuffer_ = /** @type {!WebGLBuffer} */(gl.createBuffer());

  if (we.scene.Polygon.DEBUG_LINES) {
    /**
     * @type {!WebGLBuffer}
     * @private
     */
    this.indexBufferLines_ = /** @type {!WebGLBuffer} */(gl.createBuffer());
  }

  /**
   * @type {number}
   * @private
   */
  this.numIndices_ = 0;

  var fragmentShaderCode = we.shaderbank.getShaderCode('polygon-fs.glsl');
  var vertexShaderCode = we.shaderbank.getShaderCode('polygon-vs.glsl');

  var fsshader = we.gl.Shader.create(this.context, fragmentShaderCode,
      gl.FRAGMENT_SHADER);
  var vsshader = we.gl.Shader.create(this.context, vertexShaderCode,
      gl.VERTEX_SHADER);

  this.program_ = gl.createProgram();
  if (goog.isNull(this.program_)) {
    throw Error('Unknown');
  }
  gl.attachShader(this.program_, vsshader);
  gl.attachShader(this.program_, fsshader);

  gl.bindAttribLocation(this.program_, 0, 'aVertexCoords');

  gl.linkProgram(this.program_);

  if (!gl.getProgramParameter(this.program_, gl.LINK_STATUS)) {
    throw Error('Shader program err: ' +
        gl.getProgramInfoLog(this.program_));
  }

  /**
   * @type {number}
   * @private
   */
  this.aVertexCoords_ =
      gl.getAttribLocation(this.program_, 'aVertexCoords');

  /**
   * @type {WebGLUniformLocation}
   * @private
   */
  this.uMVPMatrix_ = gl.getUniformLocation(this.program_, 'uMVPMatrix');

  /**
   * @type {WebGLUniformLocation}
   * @private
   */
  this.uColor_ = gl.getUniformLocation(this.program_, 'uColor');

  /**
   * @type {!Array.<number>}
   * @private
   */
  this.fillColor_ = [1, 0, 0, 0.8];

  /**
   * @type {!Array.<number>}
   * @private
   */
  this.strokeColor_ = [0, 0, 0, 1];

  /**
   * @type {number}
   * @private
   */
  this.roughArea_ = 0;

  /**
   * @type {boolean}
   * @private
   */
  this.valid_ = true;
};


/**
 * @define {boolean} Draw the triangulation debugging lines?
 */
we.scene.Polygon.DEBUG_LINES = true;


/**
 * @return {boolean} True if the polygon is valid (non self-intersecting).
 */
we.scene.Polygon.prototype.isValid = function() {
  return this.valid_;
};


/**
 * @param {number} lat .
 * @param {number} lng .
 * @param {number=} opt_parent Defaults to the last point.
 * @return {number} Fixed ID of the new point.
 */
we.scene.Polygon.prototype.addPoint = function(lat, lng, opt_parent) {
  var vert = new we.scene.Polygon.Node(lat, lng);
  if (this.vertices_.length == 0) {
    this.head_ = vert;
    vert.next = vert;
    vert.prev = vert;
  } else {
    var parent = this.vertices_[
        goog.math.clamp(opt_parent || Number.MAX_VALUE,
                        0, this.vertices_.length - 1)];
    vert.next = parent.next;
    parent.next = vert;
    vert.prev = parent;
    vert.next.prev = vert;
  }
  this.vertices_.push(vert);
  vert.fixedId = this.vertices_.length - 1;

  this.rebufferPoints_();
  this.solveTriangles_();

  return vert.fixedId;
};


/**
 * @param {number} fixedId .
 * @param {number} lat .
 * @param {number} lng .
 */
we.scene.Polygon.prototype.movePoint = function(fixedId, lat, lng) {
  var vert = this.vertices_[fixedId];

  vert.setLatLng(lat, lng);

  this.rebufferPoints_();
  this.solveTriangles_();
};


/**
 * Buffers the points into GPU buffer.
 * @private
 */
we.scene.Polygon.prototype.rebufferPoints_ = function() {
  var vertices = new Array(3 * this.vertices_.length);

  // recalc temporary ids
  var vrt = this.head_;
  var nextId = 0;
  do {
    vrt.tmpId = nextId++;
    vrt = vrt.next;
  } while (vrt != this.head_);

  goog.array.forEach(this.vertices_, function(el, i, arr) {
    vertices[3 * el.tmpId + 0] = el.projX;
    vertices[3 * el.tmpId + 1] = el.projY;
    vertices[3 * el.tmpId + 2] = el.projZ;
  });

  var gl = this.gl;
  gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer_);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
};


/**
 * @private
 */
we.scene.Polygon.prototype.solveTriangles_ = function() {
  var n = this.vertices_.length;
  this.roughArea_ = 0;

  //test intersection of segments
  if (n > 0) {
    this.valid_ = true;
    var a = this.head_;
    do {
      var b = a.next;
      var c = this.head_;
      do {
        var d = c.next;
        //test ab<->cd intersection
        var denom = (d.y - c.y) * (b.x - a.x) - (d.x - c.x) * (b.y - a.y);
        var p = ((d.x - c.x) * (a.y - c.y) - (d.y - c.y) * (a.x - c.x)) / denom;
        var t = ((b.x - a.x) * (a.y - c.y) - (b.y - a.y) * (a.x - c.x)) / denom;

        if (p > 0 && p < 1 && t > 0 && t < 1) {
          this.valid_ = false;
        }

        c = d;
      } while (this.valid_ && c != this.head_);
      a = b;
    } while (this.valid_ && a != this.head_);
  }

  if (!this.valid_) return;

  var signedArea = 0;
  if (n > 0) {
    var a = this.head_;
    do {
      var b = a.next;
      signedArea += a.x * b.y - a.y * b.x;
      a = b;
    } while (a != this.head_);
  }

  //NOTE: this area is wrong, but the sign is correct
  if (signedArea > 0) {
    //CCW ! reverse the points
    for (var i = 0; i < n; ++i) {
      var v = this.vertices_[i];
      var tmp = v.next;
      v.next = v.prev;
      v.prev = tmp;
    }
    this.rebufferPoints_();
  }

  var triangles = [];
  var addTriangle = goog.bind(function(v1, v2, v3) {
    triangles.push([v1.tmpId, v2.tmpId, v3.tmpId]);

    // Calculate triangle area using Heron's formula
    var len = function(u, v) {
      var x_ = u.projX - v.projX;
      var y_ = u.projY - v.projY;
      var z_ = u.projZ - v.projZ;
      return Math.sqrt(x_ * x_ + y_ * y_ + z_ * z_);
    };
    var a = len(v1, v2), b = len(v2, v3), c = len(v3, v1);
    var s = (a + b + c) / 2;
    var T = Math.sqrt(s * (s - a) * (s - b) * (s - c));
    this.roughArea_ += T;
  }, this);

  // Triangulation -- ear clipping method
  if (n < 3) {
  //triangles = [];
  } else if (n == 3) {
    addTriangle(this.head_, this.head_.prev, this.head_.next);
  } else {
    var head = this.head_;

    var Area2 = function(a, b, c) { //Calulates signed area via cross product
      return -((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
    };

    var Left = function(a, b, c) {return (Area2(a, b, c) > 0);}; //c left of ab
    var LeftOn = function(a, b, c) {return (Area2(a, b, c) >= 0);};
    var Collinear = function(a, b, c) {return (Area2(a, b, c) == 0);};
    var XOR = function(a, b) {return (a || b) && !(a && b);};

    var IntersectProp = function(a, b, c, d) { //Check proper intersection
      if (Collinear(a, b, c) || Collinear(a, b, d) ||
          Collinear(c, d, a) || Collinear(c, d, b))
        return false;
      return XOR(Left(a, b, c), Left(a, b, d)) &&
             XOR(Left(c, d, a), Left(c, d, b));
    };

    var InCone = function(a, b) { //Is line ab interal
      var a0 = a._prev, a1 = a._next;
      if (LeftOn(a, a1, a0))
        return Left(a, b, a0) && Left(b, a, a1);
      return !(LeftOn(a, b, a1) && LeftOn(b, a, a0));
    };

    var Diagonalie = function(a, b) {
      var c = head, c1;
      do {
        c1 = c._next;
        if ((c != a) && (c1 != a) && (c != b) && (c1 != b) &&
            IntersectProp(a, b, c, c1)) {
          return false;
        }
        c = c._next;
      } while (c != head);
      return true;
    };

    var Diagonal = function(a, b) {
      return InCone(a, b) && InCone(b, a) && Diagonalie(a, b);
    };

    var v0, v1, v2, v3, v4;

    goog.array.forEach(this.vertices_, function(el, i, arr) {
      el._next = el.next;
      el._prev = el.prev;
    });

    v1 = this.head_;
    do {
      v2 = v1._next;
      v0 = v1._prev;
      v1._ear = Diagonal(v0, v2);
      v1 = v1._next;
    } while (v1 != this.head_);

    var z = 99;
    while (z > 0 && n > 3) {
      z--;
      v2 = head;
      var y = 99;
      var broke;
      do {
        broke = false;
        if (v2._ear) {
          v3 = v2._next;
          v4 = v3._next;
          v1 = v2._prev;
          v0 = v1._prev;
          addTriangle(v3, v2, v1);
          v1._ear = Diagonal(v0, v3);
          v3._ear = Diagonal(v1, v4);
          v1._next = v3;
          v3._prev = v1;
          head = v3; //In case we cut out the head!
          n--;
          broke = true;
        }
        v2 = v2._next;
        y--;
      } while (y > 0 && !broke && v2 != head);
    }
    if (v1 && v3 && v4) {
      addTriangle(v4, v3, v1);
    }
  }

  var ids = goog.array.flatten(triangles);

  this.numIndices_ = ids.length;

  var gl = this.gl;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer_);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(ids), gl.STATIC_DRAW);

  if (we.scene.Polygon.DEBUG_LINES) {
    var lines = [];
    goog.array.forEach(triangles, function(el, i, arr) {
      lines.push(el[0], el[1],
                 el[1], el[2],
                 el[2], el[0]);
    });
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBufferLines_);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(lines),
                  gl.STATIC_DRAW);
  }

  window.document['title'] =
      this.roughArea_ * we.scene.EARTH_RADIUS * we.scene.EARTH_RADIUS + 'm2';
};


/**
 * Draw the polygon
 */
we.scene.Polygon.prototype.draw = function() {
  var gl = this.gl;

  gl.enable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);

  gl.useProgram(this.program_);

  var mvpm = new Float32Array(goog.array.flatten(
      this.context.mvpm.getTranspose().toArray()));

  gl.uniformMatrix4fv(this.uMVPMatrix_, false, mvpm);

  gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer_);
  gl.vertexAttribPointer(this.aVertexCoords_, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(this.aVertexCoords_);

  if (this.valid_) {
    gl.uniform4fv(this.uColor_, this.fillColor_);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer_);
    gl.drawElements(gl.TRIANGLES, this.numIndices_, gl.UNSIGNED_SHORT, 0);

    if (we.scene.Polygon.DEBUG_LINES) {
      gl.uniform4fv(this.uColor_, [0, 0, 1, 1]);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBufferLines_);
      gl.drawElements(gl.LINES, 2 * this.numIndices_, gl.UNSIGNED_SHORT, 0);
    }
  }

  gl.uniform4fv(this.uColor_, this.strokeColor_);
  gl.drawArrays(gl.LINE_LOOP, 0, this.vertices_.length);

  gl.disableVertexAttribArray(this.aVertexCoords_);

  gl.disable(gl.BLEND);
  gl.enable(gl.DEPTH_TEST);
};



/**
 * @param {number} lat .
 * @param {number} lng .
 * @param {we.scene.Polygon.Node=} opt_next .
 * @param {we.scene.Polygon.Node=} opt_prev .
 * @constructor
 */
we.scene.Polygon.Node = function(lat, lng, opt_next, opt_prev) {
  /** @type {number} */
  this.x = 0;
  /** @type {number} */
  this.y = 0;

  /** @type {number} */
  this.projX = 0;
  /** @type {number} */
  this.projY = 0;
  /** @type {number} */
  this.projZ = 0;

  this.setLatLng(lat, lng);

  /** @type {?we.scene.Polygon.Node} */
  this.next = opt_next || null;
  /** @type {?we.scene.Polygon.Node} */
  this.prev = opt_prev || null;

  /** @type {number} */
  this.fixedId = -1;
  /** @type {number} */
  this.tmpId = -1;

  /** @type {boolean} */
  this._ear = false;
  /** @type {?we.scene.Polygon.Node} */
  this._next = this.next;
  /** @type {?we.scene.Polygon.Node} */
  this._prev = this.prev;
};


/**
 * @param {number} lat .
 * @param {number} lng .
 */
we.scene.Polygon.Node.prototype.setLatLng = function(lat, lng) {
  this.x = lng / 180 * Math.PI;
  this.y = lat / 180 * Math.PI;

  var cosy = Math.cos(this.y);
  this.projX = Math.sin(this.x) * cosy;
  this.projY = Math.sin(this.y);
  this.projZ = Math.cos(this.x) * cosy;
};