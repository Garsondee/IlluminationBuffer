import { api } from './api.js';

export class IlluminationInterceptor {
    static register() {
        if (!libWrapper) {
            console.error('Illumination Buffer | libWrapper is not available.');
            return;
        }

        libWrapper.register(
            'illuminationbuffer',
            'PrimaryCanvasGroup.prototype.draw',
            function (wrapped, ...args) {
                const result = wrapped(...args);

                try {
                    const illuminationFilter = this.filters?.find(f => f.constructor.name === 'IlluminationShader');
                    if (illuminationFilter && illuminationFilter.uniforms.illuminationTexture) {
                        api.updateFromSource(illuminationFilter.uniforms.illuminationTexture);
                    } else {
                        // Fallback for older versions or different filter names
                        const legacyFilter = this.filters?.find(f => f.constructor.name.includes('Illumination'));
                        if (legacyFilter && legacyFilter.uniforms.illuminationTexture) {
                            api.updateFromSource(legacyFilter.uniforms.illuminationTexture);
                        }
                    }
                } catch (e) {
                    console.error("Illumination Buffer | Error capturing illumination texture:", e);
                }

                return result;
            },
            'WRAPPER'
        );
        console.log('Illumination Buffer | Registered interceptor on PrimaryCanvasGroup.draw');
    }
}
