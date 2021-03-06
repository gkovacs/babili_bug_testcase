/* */ 
(function(Buffer) {
  function Resize(widthOriginal, heightOriginal, targetWidth, targetHeight, blendAlpha, interpolationPass, resizeCallback) {
    this.widthOriginal = Math.abs(parseInt(widthOriginal) || 0);
    this.heightOriginal = Math.abs(parseInt(heightOriginal) || 0);
    this.targetWidth = Math.abs(parseInt(targetWidth) || 0);
    this.targetHeight = Math.abs(parseInt(targetHeight) || 0);
    this.colorChannels = (!!blendAlpha) ? 4 : 3;
    this.interpolationPass = !!interpolationPass;
    this.resizeCallback = (typeof resizeCallback == "function") ? resizeCallback : function(returnedArray) {};
    this.targetWidthMultipliedByChannels = this.targetWidth * this.colorChannels;
    this.originalWidthMultipliedByChannels = this.widthOriginal * this.colorChannels;
    this.originalHeightMultipliedByChannels = this.heightOriginal * this.colorChannels;
    this.widthPassResultSize = this.targetWidthMultipliedByChannels * this.heightOriginal;
    this.finalResultSize = this.targetWidthMultipliedByChannels * this.targetHeight;
    this.initialize();
  }
  Resize.prototype.initialize = function() {
    if (this.widthOriginal > 0 && this.heightOriginal > 0 && this.targetWidth > 0 && this.targetHeight > 0) {
      this.configurePasses();
    } else {
      throw (new Error("Invalid settings specified for the resizer."));
    }
  };
  Resize.prototype.configurePasses = function() {
    if (this.widthOriginal == this.targetWidth) {
      this.resizeWidth = this.bypassResizer;
    } else {
      this.ratioWeightWidthPass = this.widthOriginal / this.targetWidth;
      if (this.ratioWeightWidthPass < 1 && this.interpolationPass) {
        this.initializeFirstPassBuffers(true);
        this.resizeWidth = (this.colorChannels == 4) ? this.resizeWidthInterpolatedRGBA : this.resizeWidthInterpolatedRGB;
      } else {
        this.initializeFirstPassBuffers(false);
        this.resizeWidth = (this.colorChannels == 4) ? this.resizeWidthRGBA : this.resizeWidthRGB;
      }
    }
    if (this.heightOriginal == this.targetHeight) {
      this.resizeHeight = this.bypassResizer;
    } else {
      this.ratioWeightHeightPass = this.heightOriginal / this.targetHeight;
      if (this.ratioWeightHeightPass < 1 && this.interpolationPass) {
        this.initializeSecondPassBuffers(true);
        this.resizeHeight = this.resizeHeightInterpolated;
      } else {
        this.initializeSecondPassBuffers(false);
        this.resizeHeight = (this.colorChannels == 4) ? this.resizeHeightRGBA : this.resizeHeightRGB;
      }
    }
  };
  Resize.prototype._resizeWidthInterpolatedRGBChannels = function(buffer, fourthChannel) {
    var channelsNum = fourthChannel ? 4 : 3;
    var ratioWeight = this.ratioWeightWidthPass;
    var weight = 0;
    var finalOffset = 0;
    var pixelOffset = 0;
    var firstWeight = 0;
    var secondWeight = 0;
    var outputBuffer = this.widthBuffer;
    for (var targetPosition = 0; weight < 1 / 3; targetPosition += channelsNum, weight += ratioWeight) {
      for (finalOffset = targetPosition, pixelOffset = 0; finalOffset < this.widthPassResultSize; pixelOffset += this.originalWidthMultipliedByChannels, finalOffset += this.targetWidthMultipliedByChannels) {
        outputBuffer[finalOffset] = buffer[pixelOffset];
        outputBuffer[finalOffset + 1] = buffer[pixelOffset + 1];
        outputBuffer[finalOffset + 2] = buffer[pixelOffset + 2];
        if (!fourthChannel)
          continue;
        outputBuffer[finalOffset + 3] = buffer[pixelOffset + 3];
      }
    }
    weight -= 1 / 3;
    for (var interpolationWidthSourceReadStop = this.widthOriginal - 1; weight < interpolationWidthSourceReadStop; targetPosition += channelsNum, weight += ratioWeight) {
      secondWeight = weight % 1;
      firstWeight = 1 - secondWeight;
      for (finalOffset = targetPosition, pixelOffset = Math.floor(weight) * channelsNum; finalOffset < this.widthPassResultSize; pixelOffset += this.originalWidthMultipliedByChannels, finalOffset += this.targetWidthMultipliedByChannels) {
        outputBuffer[finalOffset] = (buffer[pixelOffset] * firstWeight) + (buffer[pixelOffset + channelsNum] * secondWeight);
        outputBuffer[finalOffset + 1] = (buffer[pixelOffset + 1] * firstWeight) + (buffer[pixelOffset + channelsNum + 1] * secondWeight);
        outputBuffer[finalOffset + 2] = (buffer[pixelOffset + 2] * firstWeight) + (buffer[pixelOffset + channelsNum + 2] * secondWeight);
        if (!fourthChannel)
          continue;
        outputBuffer[finalOffset + 3] = (buffer[pixelOffset + 3] * firstWeight) + (buffer[pixelOffset + channelsNum + 3] * secondWeight);
      }
    }
    for (interpolationWidthSourceReadStop = this.originalWidthMultipliedByChannels - channelsNum; targetPosition < this.targetWidthMultipliedByChannels; targetPosition += channelsNum) {
      for (finalOffset = targetPosition, pixelOffset = interpolationWidthSourceReadStop; finalOffset < this.widthPassResultSize; pixelOffset += this.originalWidthMultipliedByChannels, finalOffset += this.targetWidthMultipliedByChannels) {
        outputBuffer[finalOffset] = buffer[pixelOffset];
        outputBuffer[finalOffset + 1] = buffer[pixelOffset + 1];
        outputBuffer[finalOffset + 2] = buffer[pixelOffset + 2];
        if (!fourthChannel)
          continue;
        outputBuffer[finalOffset + 3] = buffer[pixelOffset + 3];
      }
    }
    return outputBuffer;
  };
  Resize.prototype._resizeWidthRGBChannels = function(buffer, fourthChannel) {
    var channelsNum = fourthChannel ? 4 : 3;
    var ratioWeight = this.ratioWeightWidthPass;
    var ratioWeightDivisor = 1 / ratioWeight;
    var weight = 0;
    var amountToNext = 0;
    var actualPosition = 0;
    var currentPosition = 0;
    var line = 0;
    var pixelOffset = 0;
    var outputOffset = 0;
    var nextLineOffsetOriginalWidth = this.originalWidthMultipliedByChannels - channelsNum + 1;
    var nextLineOffsetTargetWidth = this.targetWidthMultipliedByChannels - channelsNum + 1;
    var output = this.outputWidthWorkBench;
    var outputBuffer = this.widthBuffer;
    var trustworthyColorsCount = this.outputWidthWorkBenchOpaquePixelsCount;
    var multiplier = 1;
    var r = 0;
    var g = 0;
    var b = 0;
    var a = 0;
    do {
      for (line = 0; line < this.originalHeightMultipliedByChannels; ) {
        output[line++] = 0;
        output[line++] = 0;
        output[line++] = 0;
        if (!fourthChannel)
          continue;
        output[line++] = 0;
        trustworthyColorsCount[line / channelsNum - 1] = 0;
      }
      weight = ratioWeight;
      do {
        amountToNext = 1 + actualPosition - currentPosition;
        multiplier = Math.min(weight, amountToNext);
        for (line = 0, pixelOffset = actualPosition; line < this.originalHeightMultipliedByChannels; pixelOffset += nextLineOffsetOriginalWidth) {
          r = buffer[pixelOffset];
          g = buffer[++pixelOffset];
          b = buffer[++pixelOffset];
          a = fourthChannel ? buffer[++pixelOffset] : 255;
          output[line++] += (a ? r : 0) * multiplier;
          output[line++] += (a ? g : 0) * multiplier;
          output[line++] += (a ? b : 0) * multiplier;
          if (!fourthChannel)
            continue;
          output[line++] += a * multiplier;
          trustworthyColorsCount[line / channelsNum - 1] += (a ? multiplier : 0);
        }
        if (weight >= amountToNext) {
          currentPosition = actualPosition = actualPosition + channelsNum;
          weight -= amountToNext;
        } else {
          currentPosition += weight;
          break;
        }
      } while (weight > 0 && actualPosition < this.originalWidthMultipliedByChannels);
      for (line = 0, pixelOffset = outputOffset; line < this.originalHeightMultipliedByChannels; pixelOffset += nextLineOffsetTargetWidth) {
        weight = fourthChannel ? trustworthyColorsCount[line / channelsNum] : 1;
        multiplier = fourthChannel ? (weight ? 1 / weight : 0) : ratioWeightDivisor;
        outputBuffer[pixelOffset] = output[line++] * multiplier;
        outputBuffer[++pixelOffset] = output[line++] * multiplier;
        outputBuffer[++pixelOffset] = output[line++] * multiplier;
        if (!fourthChannel)
          continue;
        outputBuffer[++pixelOffset] = output[line++] * ratioWeightDivisor;
      }
      outputOffset += channelsNum;
    } while (outputOffset < this.targetWidthMultipliedByChannels);
    return outputBuffer;
  };
  Resize.prototype._resizeHeightRGBChannels = function(buffer, fourthChannel) {
    var ratioWeight = this.ratioWeightHeightPass;
    var ratioWeightDivisor = 1 / ratioWeight;
    var weight = 0;
    var amountToNext = 0;
    var actualPosition = 0;
    var currentPosition = 0;
    var pixelOffset = 0;
    var outputOffset = 0;
    var output = this.outputHeightWorkBench;
    var outputBuffer = this.heightBuffer;
    var trustworthyColorsCount = this.outputHeightWorkBenchOpaquePixelsCount;
    var caret = 0;
    var multiplier = 1;
    var r = 0;
    var g = 0;
    var b = 0;
    var a = 0;
    do {
      for (pixelOffset = 0; pixelOffset < this.targetWidthMultipliedByChannels; ) {
        output[pixelOffset++] = 0;
        output[pixelOffset++] = 0;
        output[pixelOffset++] = 0;
        if (!fourthChannel)
          continue;
        output[pixelOffset++] = 0;
        trustworthyColorsCount[pixelOffset / 4 - 1] = 0;
      }
      weight = ratioWeight;
      do {
        amountToNext = 1 + actualPosition - currentPosition;
        multiplier = Math.min(weight, amountToNext);
        caret = actualPosition;
        for (pixelOffset = 0; pixelOffset < this.targetWidthMultipliedByChannels; ) {
          r = buffer[caret++];
          g = buffer[caret++];
          b = buffer[caret++];
          a = fourthChannel ? buffer[caret++] : 255;
          output[pixelOffset++] += (a ? r : 0) * multiplier;
          output[pixelOffset++] += (a ? g : 0) * multiplier;
          output[pixelOffset++] += (a ? b : 0) * multiplier;
          if (!fourthChannel)
            continue;
          output[pixelOffset++] += a * multiplier;
          trustworthyColorsCount[pixelOffset / 4 - 1] += (a ? multiplier : 0);
        }
        if (weight >= amountToNext) {
          currentPosition = actualPosition = caret;
          weight -= amountToNext;
        } else {
          currentPosition += weight;
          break;
        }
      } while (weight > 0 && actualPosition < this.widthPassResultSize);
      for (pixelOffset = 0; pixelOffset < this.targetWidthMultipliedByChannels; ) {
        weight = fourthChannel ? trustworthyColorsCount[pixelOffset / 4] : 1;
        multiplier = fourthChannel ? (weight ? 1 / weight : 0) : ratioWeightDivisor;
        outputBuffer[outputOffset++] = Math.round(output[pixelOffset++] * multiplier);
        outputBuffer[outputOffset++] = Math.round(output[pixelOffset++] * multiplier);
        outputBuffer[outputOffset++] = Math.round(output[pixelOffset++] * multiplier);
        if (!fourthChannel)
          continue;
        outputBuffer[outputOffset++] = Math.round(output[pixelOffset++] * ratioWeightDivisor);
      }
    } while (outputOffset < this.finalResultSize);
    return outputBuffer;
  };
  Resize.prototype.resizeWidthInterpolatedRGB = function(buffer) {
    return this._resizeWidthInterpolatedRGBChannels(buffer, false);
  };
  Resize.prototype.resizeWidthInterpolatedRGBA = function(buffer) {
    return this._resizeWidthInterpolatedRGBChannels(buffer, true);
  };
  Resize.prototype.resizeWidthRGB = function(buffer) {
    return this._resizeWidthRGBChannels(buffer, false);
  };
  Resize.prototype.resizeWidthRGBA = function(buffer) {
    return this._resizeWidthRGBChannels(buffer, true);
  };
  Resize.prototype.resizeHeightInterpolated = function(buffer) {
    var ratioWeight = this.ratioWeightHeightPass;
    var weight = 0;
    var finalOffset = 0;
    var pixelOffset = 0;
    var pixelOffsetAccumulated = 0;
    var pixelOffsetAccumulated2 = 0;
    var firstWeight = 0;
    var secondWeight = 0;
    var outputBuffer = this.heightBuffer;
    for (; weight < 1 / 3; weight += ratioWeight) {
      for (pixelOffset = 0; pixelOffset < this.targetWidthMultipliedByChannels; ) {
        outputBuffer[finalOffset++] = Math.round(buffer[pixelOffset++]);
      }
    }
    weight -= 1 / 3;
    for (var interpolationHeightSourceReadStop = this.heightOriginal - 1; weight < interpolationHeightSourceReadStop; weight += ratioWeight) {
      secondWeight = weight % 1;
      firstWeight = 1 - secondWeight;
      pixelOffsetAccumulated = Math.floor(weight) * this.targetWidthMultipliedByChannels;
      pixelOffsetAccumulated2 = pixelOffsetAccumulated + this.targetWidthMultipliedByChannels;
      for (pixelOffset = 0; pixelOffset < this.targetWidthMultipliedByChannels; ++pixelOffset) {
        outputBuffer[finalOffset++] = Math.round((buffer[pixelOffsetAccumulated++] * firstWeight) + (buffer[pixelOffsetAccumulated2++] * secondWeight));
      }
    }
    while (finalOffset < this.finalResultSize) {
      for (pixelOffset = 0, pixelOffsetAccumulated = interpolationHeightSourceReadStop * this.targetWidthMultipliedByChannels; pixelOffset < this.targetWidthMultipliedByChannels; ++pixelOffset) {
        outputBuffer[finalOffset++] = Math.round(buffer[pixelOffsetAccumulated++]);
      }
    }
    return outputBuffer;
  };
  Resize.prototype.resizeHeightRGB = function(buffer) {
    return this._resizeHeightRGBChannels(buffer, false);
  };
  Resize.prototype.resizeHeightRGBA = function(buffer) {
    return this._resizeHeightRGBChannels(buffer, true);
  };
  Resize.prototype.resize = function(buffer) {
    this.resizeCallback(this.resizeHeight(this.resizeWidth(buffer)));
  };
  Resize.prototype.bypassResizer = function(buffer) {
    return buffer;
  };
  Resize.prototype.initializeFirstPassBuffers = function(BILINEARAlgo) {
    this.widthBuffer = this.generateFloatBuffer(this.widthPassResultSize);
    if (!BILINEARAlgo) {
      this.outputWidthWorkBench = this.generateFloatBuffer(this.originalHeightMultipliedByChannels);
      if (this.colorChannels > 3) {
        this.outputWidthWorkBenchOpaquePixelsCount = this.generateFloat64Buffer(this.heightOriginal);
      }
    }
  };
  Resize.prototype.initializeSecondPassBuffers = function(BILINEARAlgo) {
    this.heightBuffer = this.generateUint8Buffer(this.finalResultSize);
    if (!BILINEARAlgo) {
      this.outputHeightWorkBench = this.generateFloatBuffer(this.targetWidthMultipliedByChannels);
      if (this.colorChannels > 3) {
        this.outputHeightWorkBenchOpaquePixelsCount = this.generateFloat64Buffer(this.targetWidth);
      }
    }
  };
  Resize.prototype.generateFloatBuffer = function(bufferLength) {
    try {
      return new Float32Array(bufferLength);
    } catch (error) {
      return [];
    }
  };
  Resize.prototype.generateFloat64Buffer = function(bufferLength) {
    try {
      return new Float64Array(bufferLength);
    } catch (error) {
      return [];
    }
  };
  Resize.prototype.generateUint8Buffer = function(bufferLength) {
    try {
      return new Uint8Array(bufferLength);
    } catch (error) {
      return [];
    }
  };
  module.exports = Resize;
})(require('buffer').Buffer);
