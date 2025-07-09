      
# IlluminationBuffer

[![Foundry Version](https://img.shields.io/badge/Foundry%20VTT-v10%2B-orange.svg)](https://foundryvtt.com/)
[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/)

A real-time graphics utility that intercepts and caches the final composite lightmap from Foundry VTT's lighting render pass. This module provides a persistent, scene-sized `PIXI.RenderTexture` that is updated on each lighting refresh with minimal performance overhead, enabling developers to create sophisticated, real-time visual effects that react dynamically to the scene's illumination.

---

## What is This?

**IlluminationBuffer** is a developer tool. It does not provide any direct user-facing features on its own. Its sole purpose is to solve a complex graphics problem: how to get an efficient, real-time reference to the scene's complete lighting information.

This information is exposed as a GPU texture resource, intended to be fed directly into custom `PIXI.Filter` instances and GLSL shaders. This allows for advanced effects such as:

*   Creating textures or tiles that are only visible in darkness.
*   Masking visual effects to only appear in well-lit areas.
*   Applying color grading or other screen-space effects based on the underlying light level.
*   Building complex, layered lighting models.

## How It Works

Foundry VTT's lighting is rendered in a multi-stage process using ephemeral (short-lived) framebuffers. Attempting to capture this via high-level hooks is unreliable.

This module works by injecting a low-level intercept directly into the WebGL rendering context.

1.  It wraps the `gl.useProgram` and `gl.drawElements` functions to act as a state machine, precisely detecting the start and end of the lighting pass.
2.  At the exact moment the final lightmap is complete, it performs a direct GPU-to-GPU copy (a `blit`) from the engine's temporary framebuffer to a persistent `PIXI.RenderTexture` managed by this module.
3.  This operation is extremely fast as the data never needs to be transferred from the GPU to the CPU.
4.  The module's API then exposes this persistent texture for other modules to use in the same rendering frame.

## API and Usage Guide

IlluminationBuffer exposes its API on the `game` global. To access it, other modules should wait for the `canvasReady` hook.

### Getting the Lightmap Texture

The primary function of the API is to return the lightmap texture.

```
let lightmapTexture = null;

Hooks.on("canvasReady", () => {
    // Check if the API and its texture are available
    if (game.modules.get('illumination-buffer')?.api?.isReady()) {
        lightmapTexture = game.modules.get('illumination-buffer').api.getTexture();
    }
});
```

API Reference

game.modules.get('illumination-buffer').api

    api.getTexture(): PIXI.RenderTexture | null

        Returns a direct reference to the persistent PIXI.RenderTexture containing the scene's illumination data. The texture is a greyscale image where white (1.0) is fully lit and black (0.0) is fully dark.

        Returns null if the module is disabled or has not yet performed its first successful capture.

    api.isReady(): boolean

        Returns true if the module is active and the texture returned by getTexture() contains valid data. It's recommended to check this before attempting to use the texture.

Full Example: The "Darkness Mask" Filter

Here is a practical example of how to create a PIXI.Filter that uses the illumination buffer to make a sprite's texture visible only in areas with less than 20% light.

1. The JavaScript side (your module):

```
// A hypothetical function in your module to apply the filter
function applyMyFilter(sprite) {
    const api = game.modules.get('illumination-buffer')?.api;
    if (!api || !api.isReady()) {
        console.warn("IlluminationBuffer API not ready.");
        return;
    }

    const lightmapTexture = api.getTexture();

    const uniforms = {
        // Pass the lightmap texture to the shader
        uLightmap: lightmapTexture,
        // The light level threshold (0.0 to 1.0)
        uLightThreshold: 0.2 
    };

    // The vertex and fragment shaders would be defined elsewhere,
    // often as string constants or loaded from separate .glsl files.
    const vertexShader = `...`; // Standard PIXI vertex shader
    const fragmentShader = `...`; // See GLSL code below

    const filter = new PIXI.Filter(vertexShader, fragmentShader, uniforms);
    sprite.filters = [filter];
}
```

2. The GLSL side (your fragment shader):

The vertex shader can be the standard one provided by PIXI. The fragment shader is where the magic happens.


```
// fragmentShader.glsl

varying vec2 vTextureCoord;
uniform sampler2D uSampler;      // The sprite's own texture (passed by PIXI)
uniform sampler2D uLightmap;     // Our illumination texture
uniform float uLightThreshold;   // Our custom threshold

void main(void) {
    // 1. Get the original color of the sprite's pixel
    vec4 originalColor = texture2D(uSampler, vTextureCoord);

    // 2. Get the light value from our buffer at the same screen position
    //    We only need one channel (e.g., .r) since it's greyscale
    float illumination = texture2D(uLightmap, vTextureCoord).r;

    // 3. If the light level is BELOW our threshold, show the pixel
    if (illumination < uLightThreshold) {
        gl_FragColor = originalColor;
    } else {
        // Otherwise, make the pixel fully transparent
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    }
}
```
    

The module can be configured in the "Module Settings" panel.

    Enable IlluminationBuffer: A master switch to enable or disable the module. Disabling it will completely unpatch the WebGL functions and release all GPU resources.

    Enable Debug Mode: When enabled, a successful capture will also trigger a pop-up window displaying the raw lightmap texture. This is useful for visual debugging but incurs a performance cost and should be disabled for normal gameplay.

A Note on Implementation & Contributions

The goal of this module is to be as efficient and "zero-cost" as possible. Intercepting a real-time graphics pipeline like Foundry's is non-trivial. The current approach uses a wrapper around core WebGL functions to detect the correct moment for capture.

While this method is effective, it may not be the most optimal or robust solution. There could be unforeseen edge cases or more efficient techniques available within the PIXI.js or Foundry VTT API.

I wholeheartedly welcome contributions, suggestions, and pull requests from developers with deeper experience in WebGL, PIXI.js, and the Foundry VTT rendering engine. If you have an idea for improving the capture mechanism, enhancing stability, or reducing overhead, please open an issue or a pull request on the project's GitHub repository.
License

This module is licensed under the MIT License.
