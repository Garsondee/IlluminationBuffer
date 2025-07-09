/**
 * IlluminationBuffer
 *
 * A real-time graphics utility that intercepts and caches the final composite lightmap
 * from Foundry VTT's lighting render pass into a persistent PIXI.RenderTexture.
 *
 * This enables other modules to create sophisticated visual effects that react
 * dynamically to the scene's illumination with minimal performance overhead.
 */

const MODULE_ID = 'illuminationbuffer';

// --- MODULE STATE ---
// These variables manage the resources and state for the real-time mode.
let persistentTexture = null;
let isApiReady = false;
let isInterceptorArmed = false;
let originalGLFunctions = {
    useProgram: null,
    drawElements: null,
};

// ====================================================================================
//                            API DEFINITION
// ====================================================================================

/**
 * The public API exposed on `game.modules.get('illuminationbuffer').api`.
 * This object is created during the 'init' hook to ensure it's available for
 * other modules to reference as early as possible.
 */
const IlluminationBufferAPI = {
    /**
     * Returns a direct reference to the persistent PIXI.RenderTexture containing
     * the scene's illumination data.
     * @returns {PIXI.RenderTexture | null} The lightmap texture, or null if not ready.
     */
    getTexture() {
        if (!isApiReady) {
            console.warn(`${MODULE_ID} | API 'getTexture' called before buffer was ready.`);
            return null;
        }
        return persistentTexture;
    },

    /**
     * Checks if the module is active and the texture is ready for use.
     * @returns {boolean} True if the texture contains valid data.
     */
    isReady() {
        return isApiReady;
    }
};

// ====================================================================================
//                             CORE LOGIC
// ====================================================================================

// --- REAL-TIME MODE ---

/**
 * Arms the persistent, real-time WebGL interceptor.
 * This function wraps `gl.useProgram` and `gl.drawElements` to continuously
 * copy the lightmap to our persistent texture on every lighting update.
 */
function armRealTimeCapture() {
    const renderer = canvas.app?.renderer;
    const gl = renderer?.gl;

    if (!gl || isInterceptorArmed) {
        return;
    }

    console.log(`${MODULE_ID} | Arming real-time capture interceptor.`);

    // Store original functions if we haven't already
    if (!originalGLFunctions.useProgram) {
        originalGLFunctions.useProgram = gl.useProgram;
        originalGLFunctions.drawElements = gl.drawElements;
    }

    let inTargetShaderPass = false;
    let lastCapturedTexture = null;

    // --- Intercept `gl.useProgram` (The State Controller) ---
    gl.useProgram = function(program) {
        // EXIT Condition: If we were in the pass and the shader is changing, the pass is over.
        if (inTargetShaderPass) {
            inTargetShaderPass = false;
            // This is the moment to perform our high-speed GPU copy.
            if (lastCapturedTexture && lastCapturedTexture.valid && persistentTexture) {
                const tempSprite = new PIXI.Sprite(lastCapturedTexture);
                // Blit (GPU-to-GPU copy) the ephemeral texture to our persistent one.
                renderer.render(tempSprite, { renderTexture: persistentTexture, clear: false });
                tempSprite.destroy();
                
                // On the first successful capture, flag the API as ready.
                if (!isApiReady) {
                    isApiReady = true;
                    console.log(`${MODULE_ID} | First lightmap captured. API is now ready.`);
                }
            }
        }

        // ENTRY Condition: Check if the new program is the lighting shader.
        try {
            const source = gl.getShaderSource(gl.getAttachedShaders(program)[1]);
            if (source && source.includes("pixi-shader-15")) {
                inTargetShaderPass = true;
            }
        } catch (e) {
            // Ignore errors, some programs might not have a valid source to get.
        }
        
        return originalGLFunctions.useProgram.apply(this, arguments);
    };

    // --- Intercept `gl.drawElements` (The Data Recorder) ---
    gl.drawElements = function(...args) {
        const originalReturn = originalGLFunctions.drawElements.apply(this, args);
        // While in the lighting pass, continuously save a reference to the render target.
        if (inTargetShaderPass) {
            lastCapturedTexture = renderer.renderTexture.current;
        }
        return originalReturn;
    };

    isInterceptorArmed = true;
}

/**
 * Tears down all resources and restores the WebGL context for the real-time mode.
 * This is crucial for preventing memory leaks and ensuring clean state.
 */
function tearDownRealTime() {
    console.log(`${MODULE_ID} | Tearing down real-time capture resources.`);
    
    // Restore original WebGL functions if they were patched
    if (isInterceptorArmed && originalGLFunctions.useProgram) {
        const gl = canvas.app?.renderer?.gl;
        if (gl) {
            gl.useProgram = originalGLFunctions.useProgram;
            gl.drawElements = originalGLFunctions.drawElements;
        }
    }

    // Destroy the texture to free up GPU memory
    if (persistentTexture) {
        persistentTexture.destroy(true);
        persistentTexture = null;
    }
    
    // Remove listeners
    canvas.app?.renderer.off('resize', onCanvasResize);

    // Reset state flags
    isApiReady = false;
    isInterceptorArmed = false;
}

/**
 * Handles canvas resizing by recreating the persistent texture with the new dimensions.
 */
function onCanvasResize(width, height) {
    console.log(`${MODULE_ID} | Canvas resized. Recreating persistent texture.`);
    if (persistentTexture) {
        persistentTexture.destroy(true);
    }
    persistentTexture = PIXI.RenderTexture.create({
        width: width,
        height: height,
        resolution: canvas.app.renderer.resolution,
    });
}


// --- DEBUG MODE (ONE-SHOT CAPTURE) ---

/**
 * Arms a precise, one-shot WebGL interceptor that captures the final composite lightmap
 * and displays it in a new window. This is the user's original debug code, preserved
 * for its utility in inspecting the raw output.
 * It automatically cleans itself up after one successful capture.
 */
function armOneShotDebugCapture() {
    if (window.illuminationBufferDebugCaptureArmed) {
        ui.notifications.warn("IlluminationBuffer | A debug capture is already armed.");
        return;
    }
    window.illuminationBufferDebugCaptureArmed = true;

    const renderer = canvas.app?.renderer;
    const gl = renderer?.gl;

    if (!gl) {
        ui.notifications.error("IlluminationBuffer | Capture failed: WebGL context (gl) not found.");
        delete window.illuminationBufferDebugCaptureArmed;
        return;
    }

    const originalUseProgram = gl.useProgram;
    const originalDrawElements = gl.drawElements;

    let inTargetShaderPass = false;
    let lastCapturedTexture = null;
    let drawCountInPass = 0;

    console.log(`%c--- IlluminationBuffer | DEBUG CAPTURE ARMED ---`, 'color: #FFA500; font-size: 14px; font-weight: bold;');
    ui.notifications.info("IlluminationBuffer | Ready for debug capture. Move a token or light to trigger.");

    gl.useProgram = function(program) {
        if (inTargetShaderPass) {
            console.log(`%c[Debug Capture] EXITING 'pixi-shader-15' pass after ${drawCountInPass} draws. Capturing final result.`, "background: #1E90FF; color: white;");

            if (lastCapturedTexture && lastCapturedTexture.valid) {
                const canvasSnapshot = renderer.extract.canvas(lastCapturedTexture);
                const dataURL = canvasSnapshot.toDataURL("image/png");
                
                const newWindow = window.open();
                if (newWindow) {
                    newWindow.document.write(`<body style="margin:0; background-color:#333;"><img src="${dataURL}" alt="Final Composite Lightmap"></body>`);
                    newWindow.document.title = "IlluminationBuffer - Debug Capture";
                }
            } else {
                ui.notifications.warn("IlluminationBuffer | Capture triggered, but no valid texture was found.");
            }
            
            // --- Mission Complete: Restore everything to original state ---
            gl.useProgram = originalUseProgram;
            gl.drawElements = originalDrawElements;
            delete window.illuminationBufferDebugCaptureArmed;
            console.log("--- IlluminationBuffer | Debug capture complete. All WebGL methods restored. ---");
        }
        
        let programName = "UnknownProgram";
        try {
            const source = gl.getShaderSource(gl.getAttachedShaders(program)[1]);
            const match = source.match(/#define SHADER_NAME\s+([^\n]+)/);
            if (match) programName = match[1].trim();
        } catch (e) {}

        if (programName.includes("pixi-shader-15")) {
            if (!inTargetShaderPass) {
                console.log(`[Debug Capture] ENTERING shader pass: ${programName}.`);
                inTargetShaderPass = true;
                drawCountInPass = 0;
            }
        }
        
        return originalUseProgram.apply(this, arguments);
    };
    
    gl.drawElements = function(...args) {
        const originalReturn = originalDrawElements.apply(this, args);
        if (inTargetShaderPass) {
            drawCountInPass++;
            lastCapturedTexture = renderer.renderTexture.current;
        }
        return originalReturn;
    };
}

// ====================================================================================
//                            FOUNDRY VTT HOOKS
// ====================================================================================

/**
 * The 'init' hook is used for early setup, like registering module settings
 * and setting up the API namespace.
 */
Hooks.once('init', () => {
    console.log(`${MODULE_ID} | Initializing.`);

    // Expose the public API.
    game.modules.set(MODULE_ID, { api: IlluminationBufferAPI });

    // Register the setting for enabling debug mode.
    game.settings.register(MODULE_ID, 'enableDebugMode', {
        name: "Enable Debug Mode",
        hint: "If checked, the module will not provide a real-time buffer. Instead, it will arm a one-shot capture that opens the lightmap in a new window when triggered. Requires a reload.",
        scope: 'client',
        config: true,
        type: Boolean,
        default: false,
        requiresReload: true,
    });
});

/**
 * The 'ready' hook is fired when the game world is fully loaded.
 * This is where we decide which mode to activate.
 */
Hooks.once('ready', () => {
    const isDebugMode = game.settings.get(MODULE_ID, 'enableDebugMode');

    if (isDebugMode) {
        console.log(`${MODULE_ID} | Operating in One-Shot Debug Mode.`);
        // In debug mode, we just arm the capture and wait.
        // We hook into canvasReady to ensure the GL context is available.
        Hooks.once('canvasReady', () => {
            armOneShotDebugCapture();
        });
    } else {
        console.log(`${MODULE_ID} | Operating in Real-Time Buffer Mode.`);
        // In real-time mode, we set up our resources when the canvas is ready.
        Hooks.on('canvasReady', () => {
            // Create the persistent texture for the first time.
            onCanvasResize(canvas.screenDimensions[0], canvas.screenDimensions[1]);
            
            // Listen for canvas resizing to keep the texture dimensions correct.
            canvas.app.renderer.on('resize', onCanvasResize);

            // Arm the continuous interceptor.
            armRealTimeCapture();
        });

        // Register the cleanup function for when the canvas is destroyed.
        Hooks.on('canvasTearDown', () => {
            tearDownRealTime();
        });
    }
});
