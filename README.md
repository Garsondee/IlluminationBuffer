# IlluminationBuffer

![alt text](https://img.shields.io/badge/Foundry%20VTT-v10%2B-orange.svg)


![alt text](https://img.shields.io/badge/License-MIT-green.svg)

A real-time graphics utility that intercepts and caches the final composite lightmap from Foundry VTT's lighting render pass. This module provides a persistent, scene-sized PIXI.RenderTexture that is updated on each lighting refresh with minimal performance overhead, enabling developers to create sophisticated, real-time visual effects that react dynamically to the scene's illumination.
What is This?

IlluminationBuffer is a developer tool. It does not provide any direct user-facing features on its own. Its sole purpose is to solve a complex graphics problem: how to get an efficient, real-time reference to the scene's complete lighting information.

This information is exposed as a GPU texture resource, intended to be fed directly into custom PIXI.Filter instances and GLSL shaders. This allows for advanced effects such as:

* Creating textures or tiles that are only visible in darkness.

* Masking visual effects to only appear in well-lit areas.

* Applying color grading or other screen-space effects based on the underlying light level.

* Building complex, layered lighting models.

## How It Works

Foundry VTT's lighting is rendered in a multi-stage process using ephemeral (short-lived) textures that are discarded after each frame. Attempting to capture this via high-level hooks is unreliable.

This module uses libWrapper to precisely intercept the moment the final illumination texture is generated.

    When API mode is active, the module registers a wrapper on Foundry's internal canvas.effects.illumination.filter.apply method. This is the exact function where the final, combined illumination texture is used.

    Inside the wrapper, the module gains access to the engine's temporary illumination texture.

    It then performs a direct GPU-to-GPU copy (a blit) from the engine's texture to a persistent PIXI.RenderTexture managed by this module.

    This operation is extremely fast as the data never needs to be transferred from the GPU to the CPU.

    The module's API then exposes this persistent texture for other modules to use in the same rendering frame.

## API and Usage Guide

IlluminationBuffer exposes its API on the game global and fires a hook when it is fully initialized and ready to use. Other modules should listen for this hook to safely access the API.
Waiting for the API

The most reliable way to access the API is to use the illuminationBufferReady hook. This ensures the module has initialized its texture and the interception is active.

```
let myAPI = null;

Hooks.on('illuminationBufferReady', (api) => {
    console.log("Illumination Buffer is ready to use!");
    myAPI = api;
    
    // Now you can safely use the API
    // For example, get the texture and apply a filter
    const someSprite = canvas.background.children[0];
    applyMyFilter(someSprite);
});
```
    
## API Reference

The API object is available at game.modules.get('illuminationbuffer').api.
api.getLightingTexture(): PIXI.RenderTexture | null

Returns a direct reference to the persistent PIXI.RenderTexture containing the scene's illumination data. The texture is a greyscale image where the red channel represents the light level (1.0 is fully lit, 0.0 is fully dark).

Returns null if the module is in debug mode or has not yet initialized. The texture's valid property can also be checked to ensure it contains data.
Full Example: The "Darkness Mask" Filter

Here is a practical example of how to create a PIXI.Filter that uses the illumination buffer to make a sprite's texture visible only in areas with less than 20% light.

1. The JavaScript side (your module):

```
      
// A hypothetical function in your module to apply the filter
function applyMyFilter(sprite) {
    // We assume the API has already been retrieved from the 'illuminationBufferReady' hook
    const api = game.modules.get('illuminationbuffer')?.api;

    // Check if the API and its texture are available and valid
    if (!api?.getLightingTexture()?.valid) {
        console.warn("IlluminationBuffer API not ready or texture is invalid.");
        return;
    }

    const lightmapTexture = api.getLightingTexture();

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

    // 2. Get the light value from our buffer at the same screen position.
    //    We only need one channel (e.g., .r) since it's greyscale.
    float illumination = texture2D(uLightmap, vTextureCoord).r;

    // 3. If the light level is BELOW our threshold, show the pixel.
    if (illumination < uLightThreshold) {
        gl_FragColor = originalColor;
    } else {
        // Otherwise, make the pixel fully transparent.
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    }
}

```


The module can be configured in the "Module Settings" panel.
Enable Debug Mode

    Default: false

    If checked, this disables the standard API mode. Instead, it arms a low-level WebGL capture that will trigger the next time the canvas lighting is refreshed (e.g., by moving a token).

    When triggered, it will capture the raw lightmap texture and display it in a new browser tab.

    This is a "one-shot" tool for developers to inspect the raw lighting data and is not intended for normal use.

Enable Live Preview

    Default: false

    If checked, a small preview of the illumination buffer will be shown in the top-left corner of the screen.

    This setting requires API Mode to be active (i.e., "Enable Debug Mode" must be disabled).

    This is useful for real-time visual debugging of the API's output.

## A Note on Implementation & Contributions

The goal of this module is to be as efficient and "zero-cost" as possible. The current approach uses libWrapper to target a specific function in Foundry's rendering pipeline, which has proven to be stable and performant.

While this method is effective, there may be unforeseen edge cases or more efficient techniques available within the PIXI.js or Foundry VTT API.

I wholeheartedly welcome contributions, suggestions, and pull requests from developers with deeper experience in WebGL, PIXI.js, and the Foundry VTT rendering engine. If you have an idea for improving the capture mechanism, enhancing stability, or reducing overhead, please open an issue or a pull request on the project's GitHub repository.
License

This module is licensed under the MIT License.
