import { api } from './api.js';

// --- Configuration Constants ---
const PREVIEW_SCALE = 0.20; // 20% of its original size.
const PREVIEW_OFFSET_X = 15; // Pixels from the left edge of the screen.
const PREVIEW_OFFSET_Y = 15; // Pixels from the top edge of the screen.
const PREVIEW_ALPHA = 0.8;   // Opacity of the preview.
// -----------------------------

const interceptorState = {
    didCopy: false,
};

let previewSprite = null;

Hooks.once('init', async function () {
  // *** NEW: Expose the API for other modules to use. ***
  // We do this in 'init' so it's available as early as possible.
  game.modules.get('illuminationbuffer').api = api;
  console.log("IlluminationBuffer | API object has been exposed globally.");

  game.settings.register('illuminationbuffer', 'debugMode', {
    name: 'Enable Debug Mode',
    hint: 'If checked, the module will capture the lighting buffer on the next opportunity and display it in a new tab. The capture is armed by moving a token. The page will reload after changing this setting.',
    scope: 'client',
    config: true,
    type: Boolean,
    default: false,
    onChange: () => window.location.reload(),
  });

  game.settings.register('illuminationbuffer', 'livePreview', {
    name: 'Enable Live Preview',
    hint: 'If checked, a small preview of the illumination buffer will be shown in the corner of the screen. Requires API mode.',
    scope: 'client',
    config: true,
    type: Boolean,
    default: false,
    onChange: () => window.location.reload(),
  });
});

Hooks.once("canvasReady", function () {
  const renderer = canvas.app?.renderer;
  if (!renderer) return;

  const isDebug = game.settings.get('illuminationbuffer', 'debugMode');
  const isPreview = game.settings.get('illuminationbuffer', 'livePreview');

  if (isDebug) {
    console.log("IlluminationBuffer | Debug mode enabled. Arming single-use capture.");
    oneShotDebugCapture(renderer);
  } else {
    // This now also initializes the API that was exposed in the 'init' hook.
    api.initialize(renderer);
    console.log("IlluminationBuffer | API Initialized with renderer.");

    if (game.modules.get('lib-wrapper')?.active) {
      if (canvas?.effects?.illumination?.filter?.apply) {
        libWrapper.register(
          'illuminationbuffer',
          'canvas.effects.illumination.filter.apply',
          function (wrapped, ...args) {
            wrapped(...args);
            const sourceTexture = args[1];
            api.updateFromSource(sourceTexture, renderer);
            interceptorState.didCopy = true;
          },
          'WRAPPER'
        );
        console.log("IlluminationBuffer | libWrapper intercept is active on 'canvas.effects.illumination.filter.apply'.");
      } else {
        const errorMessage = "Could not activate Illumination Buffer API. Target 'canvas.effects.illumination.filter.apply' not found.";
        ui.notifications.error(errorMessage);
        console.error("IlluminationBuffer | " + errorMessage);
      }
    } else {
      ui.notifications.warn("The 'Illumination Buffer' module requires 'libWrapper' for its API mode to function.");
    }

    if (isPreview) {
      previewSprite = new PIXI.Sprite(api.getLightingTexture());

      previewSprite.position.set(PREVIEW_OFFSET_X, PREVIEW_OFFSET_Y);
      previewSprite.scale.set(PREVIEW_SCALE);
      previewSprite.alpha = PREVIEW_ALPHA;
      previewSprite.zIndex = 1000;

      canvas.app.stage.sortableChildren = true;
      canvas.app.stage.addChild(previewSprite);

      console.log("IlluminationBuffer | Live preview sprite created and added to the root application stage.");
    }

    canvas.app.ticker.add(() => {
      if (interceptorState.didCopy) {
        interceptorState.didCopy = false;
        if (previewSprite) {
          previewSprite.texture = api.getLightingTexture();
        }
      }
    });
    
    // *** NEW: Announce that the API is fully initialized and ready to be used. ***
    Hooks.callAll('illuminationBufferReady', api);
    console.log("IlluminationBuffer | 'illuminationBufferReady' hook fired. System is live.");
  }
});


// --- ONE-SHOT DEBUG FUNCTION (UNCHANGED) ---
function oneShotDebugCapture(renderer) {
  const gl = renderer.gl;
  if (!gl) {
    ui.notifications.error("Capture failed: WebGL context (gl) not found.");
    return;
  }

  if (window.isFinalStateMachineCaptureArmed) {
    ui.notifications.warn("A final frame capture is already armed.");
    return;
  }
  window.isFinalStateMachineCaptureArmed = true;

  const originalUseProgram = gl.useProgram;
  const originalDrawElements = gl.drawElements;

  let inTargetShaderPass = false;
  let lastCapturedTexture = null;
  let drawCountInPass = 0;

  console.log(`%c--- FINAL STATE MACHINE CAPTURE ARMED ---`, 'color: #32CD32; font-size: 16px; font-weight: bold;');
  ui.notifications.info("Ready for final capture. Move a token or light to trigger.");

  gl.useProgram = function (program) {
    if (inTargetShaderPass) {
      console.log(`%c[Capture] EXITING 'pixi-shader-15' pass after ${drawCountInPass} draws. Capturing final result.`, "background: #1E90FF; color: white;");

      if (lastCapturedTexture && lastCapturedTexture.valid) {
        const canvasSnapshot = renderer.extract.canvas(lastCapturedTexture);
        const dataURL = canvasSnapshot.toDataURL("image/png");

        const newWindow = window.open();
        if (newWindow) {
          newWindow.document.write(`<body style="margin:0; background-color:#333;"><img src="${dataURL}" alt="Final Composite Lightmap"></body>`);
          newWindow.document.title = "Final Lightmap Capture";
        }
      } else {
        ui.notifications.warn("Capture triggered, but no valid texture was found.");
      }

      gl.useProgram = originalUseProgram;
      gl.drawElements = originalDrawElements;
      delete window.isFinalStateMachineCaptureArmed;
      console.log("--- Capture complete. All WebGL methods restored. ---");
    }

    let programName = "UnknownProgram";
    try {
      const source = gl.getShaderSource(gl.getAttachedShaders(program)[1]);
      const match = source.match(/#define SHADER_NAME\s+([^\n]+)/);
      if (match) programName = match[1].trim();
    } catch (e) {}

    if (programName.includes("pixi-shader-15")) {
      if (!inTargetShaderPass) {
        console.log(`[Capture] ENTERING shader pass: ${programName}.`);
        inTargetShaderPass = true;
        drawCountInPass = 0;
      }
    }

    return originalUseProgram.apply(this, arguments);
  };

  gl.drawElements = function (...args) {
    const originalReturn = originalDrawElements.apply(this, args);

    if (inTargetShaderPass) {
      drawCountInPass++;
      lastCapturedTexture = renderer.renderTexture.current;
    }

    return originalReturn;
  };
}
