// MLInterface — 机器学习接口(神经网络 / 决策树 / SVM / KNN)。
//
// 设计:
//   * 与 ECS/AI 决策层解耦:纯数据 + 训练/推理逻辑,由外部系统调用
//   * 神经网络(neural_network)完整实现前向/反向传播 + SGD 训练
//   * KNN 实现真正的 k-近邻预测(k=3);决策树/SVM 退化为最近邻(简化实现)
//   * 模型可序列化(exportModel/importModel) + 内存存储(saveModel/loadModel)
//   * train() 异步执行,通过 getTrainingProgress() 查询进度
//
// 与 AI 模块其他组件的关系:
//   * MLInterface 可为 BehaviorTree 提供学习型决策:训练好的模型预测动作概率,
//     行为树节点读取后选择最高概率动作
//   * 与 PerceptionSystem 互补:感知系统提供输入特征,ML 模型输出决策
//   * 与 Agent 互补:模型输出可作为 Agent 的目标/转向力来源
//
// 实现说明:
//   * 神经网络权重以 Float32Array 行主序存储:weights[l][i*prevSize + j]
//     表示 prev 层神经元 j → 当前层神经元 i 的权重
//   * 激活函数统一应用于所有隐藏层与输出层(可通过 activation 字段配置)
//   * 反向传播使用 SGD(每样本更新),损失函数为 MSE
//   * KNN/决策树/SVM 的预测基于存储的训练数据(最近邻),不构建复杂模型结构

/** 模型类型。 */
export type MLModelType = 'neural_network' | 'decision_tree' | 'svm' | 'knn';

/** 激活函数类型。 */
export type ActivationType = 'sigmoid' | 'tanh' | 'relu' | 'leakyRelu';

/** 机器学习模型。 */
export interface MLModel {
  /** 模型唯一标识。 */
  id: string;
  /** 模型类型。 */
  type: MLModelType;
  /** 输入维度。 */
  inputs: number;
  /** 输出维度。 */
  outputs: number;
  /** 各层神经元数(含输出层;隐藏层 + 输出层)。 */
  layers: number[];
  /** 权重矩阵数组(每层一个 Float32Array,行主序)。 */
  weights: Float32Array[];
  /** 偏置向量数组(每层一个 Float32Array)。 */
  biases: Float32Array[];
  /** 学习率。 */
  learningRate: number;
  /** 是否已训练。 */
  isTrained: boolean;
  /** 激活函数类型(默认 sigmoid)。 */
  activation: ActivationType;
}

/** 模型创建配置。 */
export interface MLModelConfig {
  type: MLModelType;
  inputs: number;
  outputs: number;
  /** 隐藏层神经元数(输出层自动追加 outputs)。 */
  layers: number[];
  learningRate?: number;
  activation?: ActivationType;
}

/** 训练样本。 */
export interface TrainingSample {
  /** 输入特征。 */
  input: number[];
  /** 目标输出。 */
  output: number[];
  /** 样本权重(默认 1)。 */
  weight: number;
}

/** 模型导出/导入的 JSON 格式。 */
export interface MLModelJSON {
  id: string;
  type: MLModelType;
  inputs: number;
  outputs: number;
  layers: number[];
  weights: number[][];
  biases: number[][];
  learningRate: number;
  isTrained: boolean;
  activation: ActivationType;
}

/** 训练进度信息。 */
export interface TrainingProgress {
  /** 当前 epoch。 */
  current: number;
  /** 总 epoch 数。 */
  total: number;
  /** 进度 [0,1]。 */
  progress: number;
  /** 最近一次 epoch 的平均损失。 */
  lastLoss: number;
}

/** 系统统计信息。 */
export interface MLStats {
  modelCount: number;
  isTraining: boolean;
  trainingProgress: number;
  inferenceTime: number;
  totalTrainingSamples: number;
  trainedModelCount: number;
}

// 内存模型存储(path → JSON 字符串),跨平台兼容(浏览器/Node 均可用)。
const modelStorage = new Map<string, string>();

/**
 * 机器学习接口 — 管理模型集合 + 训练 + 推理。
 *
 * 用法:
 *   const ml = new MLInterface();
 *   ml.createModel('net', {
 *     type: 'neural_network', inputs: 2, outputs: 1, layers: [4],
 *     learningRate: 0.1, activation: 'sigmoid',
 *   });
 *   await ml.train('net', samples, 100);
 *   const out = ml.predict('net', [0.5, 0.5]);
 */
export class MLInterface {
  /** 模型表(id → MLModel)。 */
  models: Map<string, MLModel> = new Map();
  /** 训练数据表(id → TrainingSample[])。 */
  trainingData: Map<string, TrainingSample[]> = new Map();
  /** 是否正在训练。 */
  isTraining: boolean = false;
  /** 最近一次推理耗时(毫秒)。 */
  inferenceTime: number = 0;
  /** 训练进度。 */
  protected trainingProgress: TrainingProgress = {
    current: 0,
    total: 0,
    progress: 0,
    lastLoss: 0,
  };

  /** 创建模型(同 id 覆盖)。 */
  createModel(id: string, config: MLModelConfig): MLModel {
    if (!config || config.inputs <= 0 || config.outputs <= 0) {
      throw new Error('MLInterface.createModel: invalid config (inputs/outputs must be > 0)');
    }
    const layers = [...config.layers, config.outputs];
    if (layers.some((l) => l <= 0)) {
      throw new Error('MLInterface.createModel: layer sizes must be > 0');
    }
    const activation = config.activation ?? 'sigmoid';
    const learningRate = config.learningRate ?? 0.01;
    const model: MLModel = {
      id,
      type: config.type,
      inputs: config.inputs,
      outputs: config.outputs,
      layers,
      weights: [],
      biases: [],
      learningRate,
      isTrained: false,
      activation,
    };
    // 神经网络初始化权重(Xavier/Glorot 均匀初始化)
    if (config.type === 'neural_network') {
      let prevSize = config.inputs;
      for (const layerSize of layers) {
        const limit = Math.sqrt(6 / (prevSize + layerSize));
        const w = new Float32Array(layerSize * prevSize);
        for (let i = 0; i < w.length; i++) {
          w[i] = (Math.random() * 2 - 1) * limit;
        }
        model.weights.push(w);
        model.biases.push(new Float32Array(layerSize));
        prevSize = layerSize;
      }
    }
    this.models.set(id, model);
    this.trainingData.set(id, []);
    return model;
  }

  /** 移除模型及其训练数据。 */
  removeModel(id: string): this {
    this.models.delete(id);
    this.trainingData.delete(id);
    return this;
  }

  /** 获取模型(不存在返回 undefined)。 */
  getModel(id: string): MLModel | undefined {
    return this.models.get(id);
  }

  /** 获取所有模型(数组快照)。 */
  getModels(): MLModel[] {
    return Array.from(this.models.values());
  }

  /** 异步训练模型。
   *  neural_network:每 epoch 对所有样本做一次反向传播(SGD);
   *  其他类型:仅存储训练数据并标记 isTrained=true。 */
  async train(id: string, samples: TrainingSample[], epochs: number): Promise<void> {
    const model = this.models.get(id);
    if (!model) throw new Error(`MLInterface.train: model not found (id=${id})`);
    if (epochs <= 0) {
      model.isTrained = true;
      return;
    }
    // 合并传入样本与已存储样本
    const data = this.trainingData.get(id) ?? [];
    const allSamples = [...data, ...samples];
    if (allSamples.length === 0) {
      model.isTrained = true;
      return;
    }
    this.isTraining = true;
    this.trainingProgress = { current: 0, total: epochs, progress: 0, lastLoss: 0 };
    try {
      if (model.type === 'neural_network') {
        for (let epoch = 0; epoch < epochs; epoch++) {
          // 简单 shuffle(每 epoch 打乱样本顺序)
          const shuffled = allSamples.slice();
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          let epochLoss = 0;
          for (const sample of shuffled) {
            epochLoss += this.backwardPass(model, sample.input, sample.output, model.learningRate);
          }
          this.trainingProgress.current = epoch + 1;
          this.trainingProgress.lastLoss = epochLoss / shuffled.length;
          this.trainingProgress.progress = (epoch + 1) / epochs;
          // 每 epoch 让出事件循环,避免阻塞
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      // 存储训练数据(KNN/决策树/SVM 预测时使用)
      this.trainingData.set(id, allSamples);
      model.isTrained = true;
    } finally {
      this.isTraining = false;
    }
  }

  /** 预测:根据模型类型分派。 */
  predict(id: string, input: number[]): number[] {
    const model = this.models.get(id);
    if (!model) throw new Error(`MLInterface.predict: model not found (id=${id})`);
    const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    let result: number[];
    switch (model.type) {
      case 'neural_network':
        result = this.forwardPass(model, input);
        break;
      case 'knn':
        result = this.predictKNN(model, input, 3);
        break;
      case 'decision_tree':
        result = this.predictKNN(model, input, 1);
        break;
      case 'svm':
        result = this.predictKNN(model, input, 1);
        break;
      default:
        result = new Array(model.outputs).fill(0);
    }
    const end = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    this.inferenceTime = end - start;
    return result;
  }

  /** 添加训练数据(不触发训练)。 */
  addTrainingData(id: string, sample: TrainingSample): this {
    const data = this.trainingData.get(id);
    if (data) {
      data.push({ ...sample, weight: sample.weight ?? 1 });
    }
    return this;
  }

  /** 清空训练数据。 */
  clearTrainingData(id: string): this {
    this.trainingData.set(id, []);
    return this;
  }

  /** 导出模型为 JSON(可序列化)。 */
  exportModel(id: string): MLModelJSON {
    const model = this.models.get(id);
    if (!model) throw new Error(`MLInterface.exportModel: model not found (id=${id})`);
    return {
      id: model.id,
      type: model.type,
      inputs: model.inputs,
      outputs: model.outputs,
      layers: model.layers.slice(),
      weights: model.weights.map((w) => Array.from(w)),
      biases: model.biases.map((b) => Array.from(b)),
      learningRate: model.learningRate,
      isTrained: model.isTrained,
      activation: model.activation,
    };
  }

  /** 从 JSON 导入模型(覆盖同 id 模型)。 */
  importModel(id: string, data: MLModelJSON): MLModel {
    const model: MLModel = {
      id,
      type: data.type,
      inputs: data.inputs,
      outputs: data.outputs,
      layers: data.layers.slice(),
      weights: data.weights.map((w) => new Float32Array(w)),
      biases: data.biases.map((b) => new Float32Array(b)),
      learningRate: data.learningRate,
      isTrained: data.isTrained,
      activation: data.activation,
    };
    this.models.set(id, model);
    if (!this.trainingData.has(id)) this.trainingData.set(id, []);
    return model;
  }

  /** 神经网络前向传播:返回输出层数组。 */
  forwardPass(model: MLModel, input: number[]): number[] {
    if (model.weights.length === 0) {
      // 非神经网络类型无权重,返回零向量
      return new Array(model.outputs).fill(0);
    }
    if (input.length !== model.inputs) {
      throw new Error(
        `MLInterface.forwardPass: input size mismatch (expected ${model.inputs}, got ${input.length})`,
      );
    }
    let current: Float32Array = Float32Array.from(input);
    for (let l = 0; l < model.layers.length; l++) {
      const layerSize = model.layers[l];
      const prevSize = l === 0 ? model.inputs : model.layers[l - 1];
      const w = model.weights[l];
      const b = model.biases[l];
      const out = new Float32Array(layerSize);
      for (let i = 0; i < layerSize; i++) {
        let sum = b[i];
        const rowOffset = i * prevSize;
        for (let j = 0; j < prevSize; j++) {
          sum += w[rowOffset + j] * current[j];
        }
        out[i] = this.activate(sum, model.activation);
      }
      current = out;
    }
    return Array.from(current);
  }

  /** 神经网络反向传播:前向 + 反向 + 权重更新,返回本次样本损失(MSE)。 */
  backwardPass(model: MLModel, input: number[], target: number[], learningRate: number): number {
    if (model.weights.length === 0) return 0;
    if (input.length !== model.inputs || target.length !== model.outputs) {
      throw new Error('MLInterface.backwardPass: input/target size mismatch');
    }
    // 前向传播,缓存每层 z(pre-activation)与 a(activation)
    const activations: Float32Array[] = [Float32Array.from(input)];
    const zs: Float32Array[] = [];
    let current = activations[0];
    for (let l = 0; l < model.layers.length; l++) {
      const layerSize = model.layers[l];
      const prevSize = l === 0 ? model.inputs : model.layers[l - 1];
      const w = model.weights[l];
      const b = model.biases[l];
      const z = new Float32Array(layerSize);
      const a = new Float32Array(layerSize);
      for (let i = 0; i < layerSize; i++) {
        let sum = b[i];
        const rowOffset = i * prevSize;
        for (let j = 0; j < prevSize; j++) {
          sum += w[rowOffset + j] * current[j];
        }
        z[i] = sum;
        a[i] = this.activate(sum, model.activation);
      }
      zs.push(z);
      activations.push(a);
      current = a;
    }
    // 计算输出层误差:delta = (a - target) * activate'(a)
    // 注意:activateDerivative 接收激活值 a(非 pre-activation z)
    const outputA = activations[activations.length - 1];
    let loss = 0;
    for (let i = 0; i < outputA.length; i++) {
      loss += 0.5 * (outputA[i] - target[i]) ** 2;
    }
    const numLayers = model.layers.length;
    const deltas: Float32Array[] = new Array(numLayers);
    deltas[numLayers - 1] = new Float32Array(model.layers[numLayers - 1]);
    for (let i = 0; i < outputA.length; i++) {
      const err = outputA[i] - target[i];
      deltas[numLayers - 1][i] = err * this.activateDerivative(outputA[i], model.activation);
    }
    // 反向传播 delta
    for (let l = numLayers - 2; l >= 0; l--) {
      const layerSize = model.layers[l];
      const nextSize = model.layers[l + 1];
      const wNext = model.weights[l + 1];
      const a = activations[l + 1]; // 当前层激活值(用于求导)
      const deltaNext = deltas[l + 1];
      const delta = new Float32Array(layerSize);
      for (let i = 0; i < layerSize; i++) {
        let sum = 0;
        for (let j = 0; j < nextSize; j++) {
          sum += wNext[j * layerSize + i] * deltaNext[j];
        }
        delta[i] = sum * this.activateDerivative(a[i], model.activation);
      }
      deltas[l] = delta;
    }
    // 更新权重与偏置:W -= lr * delta * a_prev^T, b -= lr * delta
    for (let l = 0; l < numLayers; l++) {
      const layerSize = model.layers[l];
      const prevSize = l === 0 ? model.inputs : model.layers[l - 1];
      const w = model.weights[l];
      const b = model.biases[l];
      const delta = deltas[l];
      const aPrev = activations[l];
      for (let i = 0; i < layerSize; i++) {
        const rowOffset = i * prevSize;
        const di = delta[i];
        for (let j = 0; j < prevSize; j++) {
          w[rowOffset + j] -= learningRate * di * aPrev[j];
        }
        b[i] -= learningRate * di;
      }
    }
    return loss;
  }

  /** 计算均方误差损失(MSE)。 */
  computeLoss(predicted: number[], target: number[]): number {
    if (predicted.length !== target.length) {
      throw new Error('MLInterface.computeLoss: size mismatch');
    }
    let sum = 0;
    for (let i = 0; i < predicted.length; i++) {
      const d = predicted[i] - target[i];
      sum += d * d;
    }
    return sum / predicted.length;
  }

  /** 激活函数。 */
  activate(x: number, type: ActivationType): number {
    switch (type) {
      case 'sigmoid':
        return 1 / (1 + Math.exp(-x));
      case 'tanh':
        return Math.tanh(x);
      case 'relu':
        return x > 0 ? x : 0;
      case 'leakyRelu':
        return x > 0 ? x : 0.01 * x;
      default:
        return x;
    }
  }

  /** 激活函数导数(对激活值 x,即 activate(z) 的结果)。 */
  activateDerivative(x: number, type: ActivationType): number {
    switch (type) {
      case 'sigmoid':
        return x * (1 - x);
      case 'tanh':
        return 1 - x * x;
      case 'relu':
        return x > 0 ? 1 : 0;
      case 'leakyRelu':
        return x > 0 ? 1 : 0.01;
      default:
        return 1;
    }
  }

  /** 保存模型到内存存储(path 为键)。 */
  saveModel(id: string, path: string): boolean {
    const data = this.exportModel(id);
    modelStorage.set(path, JSON.stringify(data));
    return true;
  }

  /** 从内存存储加载模型(path 为键)。 */
  loadModel(id: string, path: string): boolean {
    const json = modelStorage.get(path);
    if (!json) return false;
    this.importModel(id, JSON.parse(json));
    return true;
  }

  /** 模型是否已训练。 */
  isModelTrained(id: string): boolean {
    const model = this.models.get(id);
    return model ? model.isTrained : false;
  }

  /** 获取训练进度。 */
  getTrainingProgress(): TrainingProgress {
    return { ...this.trainingProgress };
  }

  /** 获取最近一次推理耗时(毫秒)。 */
  getInferenceTime(): number {
    return this.inferenceTime;
  }

  /** 获取系统统计。 */
  getStats(): MLStats {
    let totalSamples = 0;
    let trainedCount = 0;
    for (const data of this.trainingData.values()) totalSamples += data.length;
    for (const model of this.models.values()) {
      if (model.isTrained) trainedCount++;
    }
    return {
      modelCount: this.models.size,
      isTraining: this.isTraining,
      trainingProgress: this.trainingProgress.progress,
      inferenceTime: this.inferenceTime,
      totalTrainingSamples: totalSamples,
      trainedModelCount: trainedCount,
    };
  }

  /** 释放所有模型与训练数据。 */
  dispose(): void {
    this.models.clear();
    this.trainingData.clear();
    this.isTraining = false;
    this.inferenceTime = 0;
    this.trainingProgress = { current: 0, total: 0, progress: 0, lastLoss: 0 };
  }

  /** KNN 预测:返回 k 个最近邻输出的加权平均。 */
  protected predictKNN(model: MLModel, input: number[], k: number): number[] {
    const data = this.trainingData.get(model.id) ?? [];
    if (data.length === 0) return new Array(model.outputs).fill(0);
    const actualK = Math.min(k, data.length);
    // 计算距离并排序
    const distances: Array<{ idx: number; dist: number; weight: number }> = data.map((s, i) => ({
      idx: i,
      dist: this.euclideanDistance(input, s.input),
      weight: s.weight,
    }));
    distances.sort((a, b) => a.dist - b.dist);
    // 加权平均(k 近邻)
    const result = new Array(model.outputs).fill(0);
    let totalWeight = 0;
    for (let i = 0; i < actualK; i++) {
      const sample = data[distances[i].idx];
      // 距离倒数加权(距离越近权重越大)
      const w = distances[i].dist < 1e-9 ? 1e9 : 1 / distances[i].dist;
      const sw = w * distances[i].weight;
      totalWeight += sw;
      for (let j = 0; j < model.outputs; j++) {
        result[j] += sample.output[j] * sw;
      }
    }
    if (totalWeight > 0) {
      for (let j = 0; j < model.outputs; j++) result[j] /= totalWeight;
    }
    return result;
  }

  /** 欧氏距离。 */
  protected euclideanDistance(a: number[], b: number[]): number {
    let sum = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const d = a[i] - b[i];
      sum += d * d;
    }
    return Math.sqrt(sum);
  }
}
