
/**
 * @fileoverview WebGL Earth Application object.
 *
 * @author slouppetr@gmail.com (Petr Sloup)
 *
 */

goog.provide('we');
goog.provide('we.App');

goog.require('goog.Timer');
goog.require('goog.debug.Logger');
goog.require('goog.dom');

goog.require('goog.events');
goog.require('we.debug');
goog.require('we.gl.Context');
goog.require('we.scene.Scene');
goog.require('we.ui.SceneDragger');

//Dummy dependencies
goog.addDependency('',
                   ['goog.debug.ErrorHandler', 'goog.events.EventHandler'], []);



/**
 * Creates new WebGL Earth Application object and initializes everything
 * @param {!Element} canvas Canvas element.
 * @constructor
 */
we.App = function(canvas) {
  if (goog.DEBUG) {
    we.debug.initDivConsole(goog.dom.getElement('log'));
  }

  var innerInit = function() {
    if (goog.DEBUG)
      we.logger.info('Initializing...');

    /**
     * @type {!we.gl.Context}
     */
    this.context = new we.gl.Context(canvas);
    this.context.setPerspective(50, 0.000001, 5);

    /**
     * @type {!goog.Timer}
     */
    this.loopTimer = new goog.Timer(15);
    goog.events.listen(
        this.loopTimer,
        goog.Timer.TICK,
        goog.bind(function() {this.context.renderFrame();}, this)
    );

    this.context.scene = new we.scene.Scene(this.context);

    /**
     * @type {!we.ui.SceneDragger}
     */
    this.dragger = new we.ui.SceneDragger(this.context.scene);

    if (goog.DEBUG) {
      we.logger.info('Done');
    }
  }

  if (goog.DEBUG) {
    try {
      innerInit.call(this);
    } catch (e) {
      goog.debug.Logger.getLogger('we.ex').shout(goog.debug.deepExpose(e));
    }
  } else {
    innerInit.call(this);
  }
};


/**
 * Starts the inner loop
 */
we.App.prototype.start = function() {
  if (goog.DEBUG) {
    we.logger.info('Starting the loop...');
  }
  this.loopTimer.start();
};


if (goog.DEBUG) {
  /**
   * Shared logger instance
   * @type {goog.debug.Logger}
   */
  we.logger = goog.debug.Logger.getLogger('we');
}

goog.exportSymbol('WebGLEarth', we.App);
goog.exportSymbol('WebGLEarth.prototype.start', we.App.prototype.start);