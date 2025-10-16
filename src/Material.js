class Material {
    constructor(device, vertexShaderCode, fragmentShaderCode, inputs = {}, sharedBuffers = {}) {
        this.device = device;
        this.vertexModule = device.createShaderModule({ code: vertexShaderCode });
        this.fragmentModule = device.createShaderModule({ code: fragmentShaderCode });

        // Create buffers for all defined inputs
        this.uniformBuffers = {};
        for (const [name, { size, usage }] of Object.entries(inputs)) {
            this.uniformBuffers[name] = device.createBuffer({
                size,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
        }

        // Store the shared buffers
        this.sharedBuffers = sharedBuffers;

        // Predefine the pipeline and bind group layout
        this.pipeline = null;
        this.bindGroup = null;
    }

    createPipeline(format) {
        this.pipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: this.vertexModule,
                entryPoint: 'main',
            },
            fragment: {
                module: this.fragmentModule,
                entryPoint: 'main',
                targets: [{ format }],
            },
            primitive: {
                topology: 'triangle-list',
            },
        });

        // Create the bind group including shared buffers
        const entries = Object.entries(this.uniformBuffers).map(([name, buffer], index) => ({
            binding: index,
            resource: { buffer },
        }));

        // Add the shared buffers to the bind group
        for (const [binding, buffer] of Object.entries(this.sharedBuffers)) {
            entries.push({
                binding: parseInt(binding), // Assuming binding is correct
                resource: { buffer },
            });
        }

        this.bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries,
        });
    }

    updateUniform(name, data) {
        if (!this.uniformBuffers[name]) {
            throw new Error(`Uniform '${name}' is not defined.`);
        }
        this.device.queue.writeBuffer(this.uniformBuffers[name], 0, data);
    }

    render(commandEncoder, textureView) {
        if (!this.pipeline || !this.bindGroup) {
            throw new Error("Pipeline or bind group not initialized. Call createPipeline().");
        }

        const renderPassDescriptor = {
            colorAttachments: [
                {
                    view: textureView,
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
        };

        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, this.bindGroup);
        passEncoder.draw(6);
        passEncoder.end();
    }
}

export default Material;