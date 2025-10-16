async function fetchShader(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load shader: ${url}`);
    }
    return await response.text();
}

async function include(shaderPath) {
    let shaderCode = await fetchShader(shaderPath);
    const basePath = shaderPath.substring(0, shaderPath.lastIndexOf('/'));
    const includeRegex = /^#include\s+"(.+?)"/gm;
    let match;

    while ((match = includeRegex.exec(shaderCode)) !== null) {
        const includeFile = match[1];
        const includeUrl = `${basePath}/${includeFile}`;

        try {
            const includeContent = await fetchShader(includeUrl);
            shaderCode = shaderCode.replace(match[0], includeContent);
        } catch (error) {
            throw new Error(`Failed to include file: ${includeFile} - ${error.message}`);
        }
    }

    return shaderCode;
}

export { fetchShader, include };