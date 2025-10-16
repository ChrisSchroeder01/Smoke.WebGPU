class Compute {
    constructor(device, computeShaderCode, inputs = {}, sharedBuffers = {}) {
        this.device = device;
        this.computeModule = device.createShaderModule({ code: computeShaderCode });

        // Create buffers for all defined inputs
        this.uniformBuffers = {};
        for (const [name, { size, usage }] of Object.entries(inputs)) {
            this.uniformBuffers[name] = device.createBuffer({
                size,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
        }

        // Store the shared buffers
        this.sharedBuffers = sharedBuffers; // These will be the buffers you pass, like gridBuffer

        // Predefine the pipeline and bind group layout
        this.pipeline = null;
        this.bindGroup = null;
    }

    createPipeline() {
        this.pipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: {
                module: this.computeModule,
                entryPoint: 'main',
            },
        });

        // Create the bind group including shared buffers
        const entries = Object.entries(this.uniformBuffers).map(([binding, buffer], index) => ({
            binding: parseInt(binding),
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

    run(commandEncoder, x = 1, y = 1, z = 1) {
        if (!this.pipeline || !this.bindGroup) {
            throw new Error("Pipeline or bind group not initialized. Call createPipeline().");
        }

        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, this.bindGroup);
        passEncoder.dispatchWorkgroups(x, y, z);
        passEncoder.end();
    }
}

export default Compute;