// Register the module setting for the debug mode checkbox.
Hooks.once('init', async function() {
  game.settings.register('illuminationbuffer', 'debugMode', {
    name: 'Enable Debug Frame Capture',
    hint: 'If checked, the module will arm a one-shot WebGL interceptor on canvas ready to capture the final lighting buffer for debugging purposes. The capture is triggered by moving a token or light.',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
  });
});

Hooks.once("canvasReady", function () {

  /**
   * Arms a precise, one-shot WebGL interceptor that captures the final composite lightmap
   * from Foundry VTT's lighting render pass.
     *
     * --- The Story So Far (What We Learned) ---
     * Through extensive diagnostics, we discovered that Foundry's lighting pass is a highly
     * optimized, multi-step process that uses ephemeral (very short-lived) framebuffers.
     *
     * 1.  **Timing is Critical:** High-level hooks like `canvasReady` or even `lightingRefresh`
     *     fire either too early (before the lighting textures are created) or too late (after
     *     they have been drawn and discarded).
     *
     * 2.  **It's Not a Simple Filter:** The core lighting operation is not a single post-processing
     *     filter applied to the scene. Instead, it's a sequence of direct `drawElements` calls
     *     using a specific shader (`pixi-shader-15`) to build up a lightmap texture.
     *
     * 3.  **The Solution is a State Machine:** The only reliable way to capture the final result
     *     is to intercept the lowest-level WebGL calls directly. This function acts as a "state
     *     machine":
     *      - It wraps `gl.useProgram` to detect when the GPU switches TO our target shader.
     *        This begins the "capture state".
     *      - It wraps `gl.drawElements` to know when drawing occurs. While in the "capture state",
     *        it keeps a reference to the framebuffer after each draw.
     *      - When `gl.useProgram` switches AWAY from our target shader, we know the pass is
     *        complete. At that exact moment, we capture the last saved framebuffer reference,
     *        which now holds the final, complete lightmap.
     *
     * This function is designed to be called once and will automatically clean itself up
     * after a successful capture.
   */






  
  function Frame_Capture() {
      // --- 1. Global Guard & Initial Setup ---
      if (window.isFinalStateMachineCaptureArmed) {
          ui.notifications.warn("A final frame capture is already armed.");
          return;
      }
      window.isFinalStateMachineCaptureArmed = true;

      const renderer = canvas.app?.renderer;
      const gl = renderer?.gl;

      if (!gl) {
          ui.notifications.error("Capture failed: WebGL context (gl) not found.");
          delete window.isFinalStateMachineCaptureArmed;
          return;
      }

      const originalUseProgram = gl.useProgram;
      const originalDrawElements = gl.drawElements;

      // --- 2. State Machine Variables ---
      let inTargetShaderPass = false;
      let lastCapturedTexture = null;
      let drawCountInPass = 0;

      console.log(`%c--- FINAL STATE MACHINE CAPTURE ARMED ---`, 'color: #32CD32; font-size: 16px; font-weight: bold;');
      ui.notifications.info("Ready for final capture. Move a token or light to trigger.");

      // --- 3. Intercept `gl.useProgram` (The State Controller) ---
      gl.useProgram = function(program) {
          // --- A. Check for EXIT condition FIRST ---
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
              
              // --- Mission Complete: Restore Everything to original state ---
              gl.useProgram = originalUseProgram;
              gl.drawElements = originalDrawElements;
              delete window.isFinalStateMachineCaptureArmed;
              console.log("--- Capture complete. All WebGL methods restored. ---");
          }
          
          // --- B. Check for ENTRY condition ---
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
      
      // --- 4. Intercept `gl.drawElements` (The Data Recorder) ---
      gl.drawElements = function(...args) {
          const originalReturn = originalDrawElements.apply(this, args);

          if (inTargetShaderPass) {
              drawCountInPass++;
              lastCapturedTexture = renderer.renderTexture.current;
          }
          
          return originalReturn;
      };
  }

  // Check for a debug flag from settings before arming the capture.
  // NOTE: This assumes you have a setting with the key 'debugMode'.
  const isDebug = game.settings.get('illuminationbuffer', 'debugMode');
  if (isDebug) {
      Frame_Capture();
  }
});
