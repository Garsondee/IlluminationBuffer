// ====================================================================================
// Illumination Buffer API
// ====================================================================================

class IlluminationBufferAPI {
    _persistentTexture = null;

    initialize(renderer) {
        if (this._persistentTexture) {
            this._persistentTexture.destroy();
        }
        this._persistentTexture = PIXI.RenderTexture.create({
            width: renderer.screen.width,
            height: renderer.screen.height,
        });
        renderer.texture.bind(this._persistentTexture.baseTexture);
        //console.log(`[API] Persistent texture created. Dimensions: ${this._persistentTexture.width}x${this._persistentTexture.height}, Valid: ${this._persistentTexture.valid}`);
    }

    getLightingTexture() {
        return this._persistentTexture;
    }

    updateFromSource(sourceTexture, renderer) {
        //console.log(`[API] updateFromSource called. Source valid: ${sourceTexture?.valid}. Target valid: ${this._persistentTexture?.valid}`);
        if (!sourceTexture?.valid || !this._persistentTexture || !this._persistentTexture.baseTexture) {
            //console.warn("[API] Aborting updateFromSource due to invalid texture.");
            return;
        }

        const tempSprite = new PIXI.Sprite(sourceTexture);
        renderer.render(tempSprite, { renderTexture: this._persistentTexture, clear: false });
        tempSprite.destroy();
        //console.log("[API] Copy complete via renderer.render.");
    }
}

export const api = new IlluminationBufferAPI();
