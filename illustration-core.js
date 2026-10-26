/* SpiralIllustrationCore (include/spiral_illustration/IllustrationCore.h) の JavaScript 移植。
   Spiral DAW / Paint / Manga と同じペン太さ・ツール分類・QuickShape 判定をこのゲームでも使う。
   元の C++ と関数名・しきい値をそろえてあるので、コア側を直したときは同じ箇所を直す。 */
(() => {
  'use strict';

  const defaultStrokeThickness = 1.6;
  // 太さはおおよそ標準キャンバス上のピクセル幅。細いペン線から、キャンバスの高さほどまで。
  const minimumStrokeThickness = 0.6;
  const maximumStrokeThickness = 400.0;
  const defaultStrokeOpacity = 1.0;
  const minimumStrokeOpacity = 0.0;
  const maximumStrokeOpacity = 1.0;
  const defaultStrokeSmoothingAmount = 0.55;

  const defaultCanvasAspectRatio = 16 / 9;
  const mangaPageCanvasAspectRatio = 176 / 250;

  const ToolKind = { pen: 'pen', brushSoft: 'brushSoft', brushFlat: 'brushFlat', brushWide: 'brushWide', eraserSharp: 'eraserSharp', eraserSoft: 'eraserSoft', eraserBlock: 'eraserBlock' };
  const QuickShapeKind = { none: 'none', line: 'line', angle: 'angle', curve: 'curve', rectangle: 'rectangle', ellipse: 'ellipse', circle: 'circle' };

  const quickShapeHoldMilliseconds = 420.0;
  const quickShapeMorphMilliseconds = 260.0;
  const quickShapeMinimumDragDistance = 0.018;
  const quickShapeStationaryDistance = 0.006;
  const quickShapeCurveSamples = 24;
  const quickShapeEllipseSamples = 64;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const clampStrokeThickness = t => clamp(t, minimumStrokeThickness, maximumStrokeThickness);

  // ペン太さ20段階: 6段目(1.6)が初期値。10段目までは0.2刻み、そこから約1.67倍ずつキャンバス大まで。
  const strokeThicknessSteps = [
    0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.4,
    4.0, 6.7, 11.0, 19.0, 31.0, 52.0, 86.0, 144.0, 240.0, 400.0,
  ];

  // 太さに一番近い段（1始まり）
  function getNearestStrokeThicknessStep(thickness) {
    let nearestStep = 1;
    for (let index = 1; index < strokeThicknessSteps.length; ++index) {
      if (Math.abs(strokeThicknessSteps[index] - thickness) < Math.abs(strokeThicknessSteps[nearestStep - 1] - thickness)) nearestStep = index + 1;
    }
    return nearestStep;
  }

  const clampStrokeOpacity = o => clamp(o, minimumStrokeOpacity, maximumStrokeOpacity);
  const clampStrokeSmoothingAmount = a => clamp(a, 0, 1);
  const isBrushTool = tool => tool === ToolKind.brushSoft || tool === ToolKind.brushFlat || tool === ToolKind.brushWide;
  const isEraserTool = tool => tool === ToolKind.eraserSharp || tool === ToolKind.eraserSoft || tool === ToolKind.eraserBlock;

  const add = (l, r) => ({ x: l.x + r.x, y: l.y + r.y });
  const subtract = (l, r) => ({ x: l.x - r.x, y: l.y - r.y });
  const multiply = (p, amount) => ({ x: p.x * amount, y: p.y * amount });
  const distance = (l, r) => Math.hypot(l.x - r.x, l.y - r.y);
  function normalize(p) {
    const length = Math.hypot(p.x, p.y);
    return length <= 0.000001 ? { x: 0, y: 0 } : { x: p.x / length, y: p.y / length };
  }
  function pathLength(points) {
    let length = 0;
    for (let i = 1; i < points.length; ++i) length += distance(points[i - 1], points[i]);
    return length;
  }

  function resamplePathPoints(points, targetCount) {
    if (!points.length || targetCount === 0) return [];
    if (points.length === targetCount) return points.slice();
    if (targetCount === 1 || points.length === 1) return [points[0]];
    const cumulative = new Array(points.length).fill(0);
    for (let i = 1; i < points.length; ++i) cumulative[i] = cumulative[i - 1] + distance(points[i - 1], points[i]);
    const totalLength = cumulative[cumulative.length - 1];
    if (totalLength <= 0.000001) return new Array(targetCount).fill(0).map(() => ({ ...points[0] }));
    const result = [];
    let segmentIndex = 1;
    for (let s = 0; s < targetCount; ++s) {
      const targetDistance = totalLength * s / (targetCount - 1);
      while (segmentIndex + 1 < cumulative.length && cumulative[segmentIndex] < targetDistance) ++segmentIndex;
      const startDistance = cumulative[segmentIndex - 1];
      const segmentLength = Math.max(0.000001, cumulative[segmentIndex] - startDistance);
      const progress = (targetDistance - startDistance) / segmentLength;
      result.push(add(points[segmentIndex - 1], multiply(subtract(points[segmentIndex], points[segmentIndex - 1]), progress)));
    }
    result[0] = points[0];
    result[result.length - 1] = points[points.length - 1];
    return result;
  }

  function interpolatePointVectors(fromPoints, toPoints, progress) {
    if (!toPoints.length) return [];
    const p = clamp(progress, 0, 1);
    const from = resamplePathPoints(fromPoints, toPoints.length);
    if (from.length !== toPoints.length) return toPoints.slice();
    return toPoints.map((to, i) => add(multiply(from[i], 1 - p), multiply(to, p)));
  }

  function perpendicularDistanceToLine(point, start, end) {
    const line = subtract(end, start), lineLength = Math.hypot(line.x, line.y);
    if (lineLength <= 0.000001) return distance(point, start);
    const offset = subtract(point, start);
    return Math.abs(line.x * offset.y - line.y * offset.x) / lineLength;
  }

  function angleBetween(first, second) {
    const fl = Math.hypot(first.x, first.y), sl = Math.hypot(second.x, second.y);
    if (fl <= 0.000001 || sl <= 0.000001) return 0;
    return Math.abs(Math.atan2(first.x * second.y - first.y * second.x, first.x * second.x + first.y * second.y));
  }

  function findFurthestPointFromLine(points, startIndex, endIndex) {
    if (!points.length || startIndex >= endIndex || endIndex >= points.length) return startIndex;
    let bestIndex = startIndex, bestDistance = -1;
    for (let i = startIndex + 1; i < endIndex; ++i) {
      const d = perpendicularDistanceToLine(points[i], points[startIndex], points[endIndex]);
      if (d > bestDistance) { bestDistance = d; bestIndex = i; }
    }
    return bestIndex;
  }

  function getMaximumLineError(points, startIndex, endIndex) {
    if (!points.length || startIndex >= endIndex || endIndex >= points.length) return 0;
    let maximumLineError = 0;
    for (let i = startIndex; i <= endIndex; ++i) maximumLineError = Math.max(maximumLineError, perpendicularDistanceToLine(points[i], points[startIndex], points[endIndex]));
    return maximumLineError;
  }

  function getBounds(points) {
    if (!points.length) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    let minX = points[0].x, maxX = minX, minY = points[0].y, maxY = minY;
    for (const p of points) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    return { minX, maxX, minY, maxY };
  }
  function getBoundsCentre(points) {
    if (!points.length) return { x: 0, y: 0 };
    const b = getBounds(points);
    return { x: (b.minX + b.maxX) * 0.5, y: (b.minY + b.maxY) * 0.5 };
  }

  function projectPointOntoSegment(point, start, end) {
    const segment = subtract(end, start), lengthSquared = segment.x * segment.x + segment.y * segment.y;
    if (lengthSquared <= 0.000001) return start;
    const offset = subtract(point, start);
    const progress = clamp((offset.x * segment.x + offset.y * segment.y) / lengthSquared, 0, 1);
    return add(start, multiply(segment, progress));
  }

  function fitQuadrilateral(sourcePoints) {
    const result = { vertices: [], rootMeanSquareError: 1, maximumError: 1, valid: false };
    if (sourcePoints.length < 8) return result;
    let points = resamplePathPoints(sourcePoints, 65);
    if (points.length > 1 && distance(points[0], points[points.length - 1]) < 0.0001) points = points.slice(0, -1);
    if (points.length < 8) return result;

    let firstDiameterIndex = 0, secondDiameterIndex = 1, diameter = 0;
    for (let a = 0; a < points.length; ++a) {
      for (let b = a + 1; b < points.length; ++b) {
        const d = distance(points[a], points[b]);
        if (d > diameter) { diameter = d; firstDiameterIndex = a; secondDiameterIndex = b; }
      }
    }
    if (diameter <= quickShapeMinimumDragDistance) return result;

    const n = points.length;
    const findArcCorner = (startIndex, endIndex) => {
      let bestIndex = (startIndex + 1) % n, bestDistance = -1;
      for (let i = (startIndex + 1) % n; i !== endIndex; i = (i + 1) % n) {
        const d = perpendicularDistanceToLine(points[i], points[startIndex], points[endIndex]);
        if (d > bestDistance) { bestDistance = d; bestIndex = i; }
      }
      return bestIndex;
    };
    const vertexIndices = [firstDiameterIndex, findArcCorner(firstDiameterIndex, secondDiameterIndex), secondDiameterIndex, findArcCorner(secondDiameterIndex, firstDiameterIndex)];
    vertexIndices.sort((a, b) => a - b);
    for (let i = 1; i < 4; ++i) if (vertexIndices[i] === vertexIndices[i - 1]) return result;
    result.vertices = vertexIndices.map(i => points[i]);

    const b = getBounds(points), extent = Math.max(b.maxX - b.minX, b.maxY - b.minY);
    if (extent <= 0.0001) return result;

    let squaredErrorSum = 0, maximumError = 0;
    for (const point of points) {
      let pointError = extent;
      for (let e = 0; e < 4; ++e) pointError = Math.min(pointError, distance(point, projectPointOntoSegment(point, result.vertices[e], result.vertices[(e + 1) % 4])));
      squaredErrorSum += pointError * pointError;
      maximumError = Math.max(maximumError, pointError);
    }
    for (let v = 0; v < 4; ++v) {
      const previous = result.vertices[(v + 3) % 4], current = result.vertices[v], next = result.vertices[(v + 1) % 4];
      const turn = angleBetween(subtract(current, previous), subtract(next, current));
      if (distance(previous, current) < extent * 0.1 || distance(current, next) < extent * 0.1 || turn < 0.28) return result;
    }
    result.rootMeanSquareError = Math.sqrt(squaredErrorSum / points.length) / extent;
    result.maximumError = maximumError / extent;
    result.valid = true;
    return result;
  }

  function fitEllipse(sourcePoints) {
    const result = { centre: { x: 0, y: 0 }, majorAxis: { x: 1, y: 0 }, majorRadius: 0, minorRadius: 0, radialError: 1, valid: false };
    if (sourcePoints.length < 8) return result;
    let points = resamplePathPoints(sourcePoints, 65);
    if (points.length > 1 && distance(points[0], points[points.length - 1]) < 0.0001) points = points.slice(0, -1);
    if (points.length < 8) return result;

    for (const p of points) result.centre = add(result.centre, p);
    result.centre = multiply(result.centre, 1 / points.length);
    let cx = 0, cy = 0, cxy = 0;
    for (const p of points) { const o = subtract(p, result.centre); cx += o.x * o.x; cy += o.y * o.y; cxy += o.x * o.y; }
    const inverseCount = 1 / points.length;
    cx *= inverseCount; cy *= inverseCount; cxy *= inverseCount;

    const axisAngle = 0.5 * Math.atan2(2 * cxy, cx - cy);
    result.majorAxis = { x: Math.cos(axisAngle), y: Math.sin(axisAngle) };
    const minorAxis = { x: -result.majorAxis.y, y: result.majorAxis.x };
    let majorVariance = 0, minorVariance = 0;
    for (const p of points) {
      const o = subtract(p, result.centre);
      const major = o.x * result.majorAxis.x + o.y * result.majorAxis.y, minor = o.x * minorAxis.x + o.y * minorAxis.y;
      majorVariance += major * major; minorVariance += minor * minor;
    }
    majorVariance *= inverseCount; minorVariance *= inverseCount;
    if (minorVariance > majorVariance) { [majorVariance, minorVariance] = [minorVariance, majorVariance]; result.majorAxis = minorAxis; }

    result.majorRadius = Math.sqrt(Math.max(0, majorVariance * 2));
    result.minorRadius = Math.sqrt(Math.max(0, minorVariance * 2));
    if (result.minorRadius < quickShapeMinimumDragDistance * 0.25) return result;

    const fittedMinorAxis = { x: -result.majorAxis.y, y: result.majorAxis.x };
    let errorSum = 0;
    for (const p of points) {
      const o = subtract(p, result.centre);
      const major = (o.x * result.majorAxis.x + o.y * result.majorAxis.y) / result.majorRadius;
      const minor = (o.x * fittedMinorAxis.x + o.y * fittedMinorAxis.y) / result.minorRadius;
      errorSum += Math.abs(Math.sqrt(major * major + minor * minor) - 1);
    }
    result.radialError = errorSum * inverseCount;
    result.valid = true;
    return result;
  }

  function countSharpTurns(points) {
    if (points.length < 5) return 0;
    let count = 0;
    const n = points.length;
    for (let i = 0; i < n; ++i) {
      const turn = angleBetween(subtract(points[i], points[(i + n - 1) % n]), subtract(points[(i + 1) % n], points[i]));
      if (turn > 0.62) ++count;
    }
    return count;
  }

  function classifyQuickShape(points) {
    if (points.length < 2) return QuickShapeKind.none;
    const start = points[0], end = points[points.length - 1];
    const directDistance = distance(start, end), length = pathLength(points);
    if (length < quickShapeMinimumDragDistance) return QuickShapeKind.none;

    const b = getBounds(points);
    const width = b.maxX - b.minX, height = b.maxY - b.minY;
    const largerExtent = Math.max(width, height), smallerExtent = Math.min(width, height);
    const closesBack = directDistance < Math.max(0.025, largerExtent * 0.28);

    if (points.length >= 8 && closesBack && largerExtent >= quickShapeMinimumDragDistance && smallerExtent >= quickShapeMinimumDragDistance * 0.55) {
      const quadrilateral = fitQuadrilateral(points), ellipse = fitEllipse(points);
      if (quadrilateral.valid && quadrilateral.rootMeanSquareError < 0.055 && quadrilateral.maximumError < 0.13
          && (!ellipse.valid || ellipse.radialError > 0.07 || quadrilateral.rootMeanSquareError < ellipse.radialError * 0.72)) {
        return QuickShapeKind.rectangle;
      }
      const aspect = ellipse.valid && ellipse.majorRadius > 0.0001 ? ellipse.minorRadius / ellipse.majorRadius
        : (largerExtent > 0.0001 ? smallerExtent / largerExtent : 0);
      return aspect > 0.82 ? QuickShapeKind.circle : QuickShapeKind.ellipse;
    }

    const maximumLineError = getMaximumLineError(points, 0, points.length - 1);
    const lineErrorRatio = directDistance > 0.0001 ? maximumLineError / directDistance : 1;
    if (directDistance >= quickShapeMinimumDragDistance && lineErrorRatio < 0.075) return QuickShapeKind.line;

    if (points.length >= 5 && directDistance >= quickShapeMinimumDragDistance) {
      const cornerIndex = findFurthestPointFromLine(points, 0, points.length - 1);
      const corner = points[cornerIndex];
      const firstLegLength = distance(start, corner), secondLegLength = distance(corner, end);
      if (cornerIndex > 0 && cornerIndex + 1 < points.length
          && firstLegLength >= quickShapeMinimumDragDistance * 0.45 && secondLegLength >= quickShapeMinimumDragDistance * 0.45
          && lineErrorRatio >= 0.12) {
        const firstLegErrorRatio = getMaximumLineError(points, 0, cornerIndex) / Math.max(firstLegLength, 0.0001);
        const secondLegErrorRatio = getMaximumLineError(points, cornerIndex, points.length - 1) / Math.max(secondLegLength, 0.0001);
        if (firstLegErrorRatio < 0.12 && secondLegErrorRatio < 0.12) return QuickShapeKind.angle;
      }
    }

    if (points.length >= 4 && directDistance >= quickShapeMinimumDragDistance) return QuickShapeKind.curve;
    return QuickShapeKind.none;
  }

  function makeLinePoints(sourcePoints, dragPoint) {
    return sourcePoints.length ? [sourcePoints[0], dragPoint] : [];
  }

  function transformPointsFromStartToDrag(sourcePoints, dragPoint) {
    if (!sourcePoints.length) return [];
    if (sourcePoints.length === 1) return sourcePoints.slice();
    const start = sourcePoints[0];
    const sourceVector = subtract(sourcePoints[sourcePoints.length - 1], start), targetVector = subtract(dragPoint, start);
    const sourceLength = Math.hypot(sourceVector.x, sourceVector.y), targetLength = Math.hypot(targetVector.x, targetVector.y);
    if (sourceLength <= 0.000001 || targetLength <= 0.000001) return sourcePoints.slice();
    const scale = targetLength / sourceLength;
    const cosAngle = (sourceVector.x * targetVector.x + sourceVector.y * targetVector.y) / (sourceLength * targetLength);
    const sinAngle = (sourceVector.x * targetVector.y - sourceVector.y * targetVector.x) / (sourceLength * targetLength);
    const out = sourcePoints.map(p => {
      const o = subtract(p, start);
      return { x: start.x + (o.x * cosAngle - o.y * sinAngle) * scale, y: start.y + (o.x * sinAngle + o.y * cosAngle) * scale };
    });
    out[0] = start;
    out[out.length - 1] = dragPoint;
    return out;
  }

  function getAngleCornerPoint(sourcePoints) {
    if (sourcePoints.length < 3) return sourcePoints.length ? sourcePoints[0] : { x: 0, y: 0 };
    return sourcePoints[findFurthestPointFromLine(sourcePoints, 0, sourcePoints.length - 1)];
  }

  function makeAnglePoints(sourcePoints, dragPoint) {
    if (!sourcePoints.length) return [];
    if (sourcePoints.length < 3) return makeLinePoints(sourcePoints, dragPoint);
    return transformPointsFromStartToDrag([sourcePoints[0], getAngleCornerPoint(sourcePoints), sourcePoints[sourcePoints.length - 1]], dragPoint);
  }

  function getForwardTangent(sourcePoints, minimumSampleDistance) {
    if (sourcePoints.length < 2) return { x: 0, y: 0 };
    const start = sourcePoints[0];
    for (let i = 1; i < sourcePoints.length; ++i) {
      const c = subtract(sourcePoints[i], start);
      if (Math.hypot(c.x, c.y) >= minimumSampleDistance) return normalize(c);
    }
    return normalize(subtract(sourcePoints[1], start));
  }

  function getBackwardTangent(sourcePoints, minimumSampleDistance) {
    if (sourcePoints.length < 2) return { x: 0, y: 0 };
    const end = sourcePoints[sourcePoints.length - 1];
    for (let i = sourcePoints.length - 1; i > 0; --i) {
      const c = subtract(end, sourcePoints[i - 1]);
      if (Math.hypot(c.x, c.y) >= minimumSampleDistance) return normalize(c);
    }
    return normalize(subtract(end, sourcePoints[sourcePoints.length - 2]));
  }

  function appendCubicBezierSegment(result, start, firstControl, secondControl, end, sampleCount, skipFirstPoint) {
    const safe = Math.max(2, sampleCount);
    for (let s = skipFirstPoint ? 1 : 0; s < safe; ++s) {
      const t = s / (safe - 1), u = 1 - t;
      result.push(add(add(multiply(start, u * u * u), multiply(firstControl, 3 * u * u * t)), add(multiply(secondControl, 3 * u * t * t), multiply(end, t * t * t))));
    }
  }

  function makeCurvePointsToEnd(sourcePoints, endPoint) {
    if (!sourcePoints.length) return [];
    const start = sourcePoints[0];
    const tangentSampleDistance = Math.max(quickShapeMinimumDragDistance * 0.35, pathLength(sourcePoints) * 0.08);
    const startTangent = getForwardTangent(sourcePoints, tangentSampleDistance);
    const endTangent = getBackwardTangent(sourcePoints, tangentSampleDistance);
    const curvePoint = sourcePoints[findFurthestPointFromLine(sourcePoints, 0, sourcePoints.length - 1)];
    const bendTangent = normalize(subtract(endPoint, start));
    const firstHandleLength = Math.max(distance(start, curvePoint) * 0.42, quickShapeMinimumDragDistance * 0.18);
    const secondHandleLength = Math.max(distance(curvePoint, endPoint) * 0.42, quickShapeMinimumDragDistance * 0.18);
    const result = [];
    const firstSampleCount = Math.max(3, (quickShapeCurveSamples / 2 | 0) + 1);
    const secondSampleCount = Math.max(3, quickShapeCurveSamples - firstSampleCount + 2);
    appendCubicBezierSegment(result, start, add(start, multiply(startTangent, firstHandleLength)), subtract(curvePoint, multiply(bendTangent, firstHandleLength)), curvePoint, firstSampleCount, false);
    appendCubicBezierSegment(result, curvePoint, add(curvePoint, multiply(bendTangent, secondHandleLength)), subtract(endPoint, multiply(endTangent, secondHandleLength)), endPoint, secondSampleCount, true);
    return result;
  }

  function makeCurvePoints(sourcePoints, dragPoint) {
    if (!sourcePoints.length) return [];
    if (sourcePoints.length < 3) return makeLinePoints(sourcePoints, dragPoint);
    return transformPointsFromStartToDrag(makeCurvePointsToEnd(sourcePoints, sourcePoints[sourcePoints.length - 1]), dragPoint);
  }

  function makeRectanglePoints(sourcePoints, dragPoint, rotateWithDrag = true) {
    if (!sourcePoints.length) return [];
    const fit = fitQuadrilateral(sourcePoints);
    if (!fit.valid) return sourcePoints.slice();
    let centre = { x: 0, y: 0 };
    for (const v of fit.vertices) centre = add(centre, v);
    centre = multiply(centre, 0.25);

    const last = sourcePoints[sourcePoints.length - 1];
    const sourceDragDistance = distance(last, centre), targetDragDistance = distance(dragPoint, centre);
    const scale = sourceDragDistance > 0.0001 ? clamp(targetDragDistance / sourceDragDistance, 0.1, 10) : 1;
    const sv = subtract(last, centre), tv = subtract(dragPoint, centre);
    const rotation = rotateWithDrag && sourceDragDistance > 0.0001 && targetDragDistance > 0.0001 ? Math.atan2(tv.y, tv.x) - Math.atan2(sv.y, sv.x) : 0;
    const c = Math.cos(rotation), s = Math.sin(rotation);
    const transform = p => { const k = multiply(subtract(p, centre), scale); return { x: centre.x + k.x * c - k.y * s, y: centre.y + k.x * s + k.y * c }; };

    const pathStart = transform(projectPointOntoSegment(sourcePoints[0], fit.vertices[3], fit.vertices[0]));
    const result = [pathStart];
    for (const v of fit.vertices) { const tvx = transform(v); if (distance(result[result.length - 1], tvx) > 0.0001) result.push(tvx); }
    if (distance(result[result.length - 1], pathStart) > 0.0001) result.push(pathStart);
    return result;
  }

  function makeEllipsePoints(sourcePoints, dragPoint, forceCircle, rotateWithDrag) {
    if (!sourcePoints.length) return [];
    const fit = fitEllipse(sourcePoints);
    if (!fit.valid) return sourcePoints.slice();
    const centre = fit.centre, minorAxis = { x: -fit.majorAxis.y, y: fit.majorAxis.x };
    const last = sourcePoints[sourcePoints.length - 1];
    const sourceDragDistance = distance(last, centre), targetDragDistance = distance(dragPoint, centre);
    const scale = sourceDragDistance > 0.0001 ? clamp(targetDragDistance / sourceDragDistance, 0.1, 10) : 1;
    let majorRadius = fit.majorRadius * scale, minorRadius = fit.minorRadius * scale;
    if (forceCircle) majorRadius = minorRadius = (majorRadius + minorRadius) * 0.5;

    const sv = subtract(last, centre), tv = subtract(dragPoint, centre);
    const rotation = rotateWithDrag && sourceDragDistance > 0.0001 && targetDragDistance > 0.0001 ? Math.atan2(tv.y, tv.x) - Math.atan2(sv.y, sv.x) : 0;
    const c = Math.cos(rotation), s = Math.sin(rotation);
    const rotate = v => ({ x: v.x * c - v.y * s, y: v.x * s + v.y * c });
    const majorAxis = rotate(fit.majorAxis), rotatedMinorAxis = rotate(minorAxis);

    const so = subtract(sourcePoints[0], centre);
    const startMajor = (so.x * fit.majorAxis.x + so.y * fit.majorAxis.y) / Math.max(majorRadius, 0.0001);
    const startMinor = (so.x * minorAxis.x + so.y * minorAxis.y) / Math.max(minorRadius, 0.0001);
    const startAngle = Math.atan2(startMinor, startMajor);

    let signedArea = 0;
    for (let i = 1; i < sourcePoints.length; ++i) signedArea += sourcePoints[i - 1].x * sourcePoints[i].y - sourcePoints[i].x * sourcePoints[i - 1].y;
    const direction = signedArea < 0 ? -1 : 1;

    const result = [];
    for (let i = 0; i <= quickShapeEllipseSamples; ++i) {
      const angle = startAngle + direction * (i / quickShapeEllipseSamples) * Math.PI * 2;
      result.push(add(centre, add(multiply(majorAxis, Math.cos(angle) * majorRadius), multiply(rotatedMinorAxis, Math.sin(angle) * minorRadius))));
    }
    return result;
  }

  function makeQuickShapePoints(kind, sourcePoints, dragPoint, rotateWithDrag = true) {
    switch (kind) {
      case QuickShapeKind.line: return makeLinePoints(sourcePoints, dragPoint);
      case QuickShapeKind.angle: return makeAnglePoints(sourcePoints, dragPoint);
      case QuickShapeKind.curve: return makeCurvePoints(sourcePoints, dragPoint);
      case QuickShapeKind.rectangle: return makeRectanglePoints(sourcePoints, dragPoint, rotateWithDrag);
      case QuickShapeKind.ellipse: return makeEllipsePoints(sourcePoints, dragPoint, false, rotateWithDrag);
      case QuickShapeKind.circle: return makeEllipsePoints(sourcePoints, dragPoint, true, rotateWithDrag);
      default: return sourcePoints.slice();
    }
  }

  const quickShapeHasSharpCorners = kind => kind === QuickShapeKind.angle || kind === QuickShapeKind.rectangle;

  (window.BK = window.BK || {}).ill = {
    defaultStrokeThickness, minimumStrokeThickness, maximumStrokeThickness,
    defaultStrokeOpacity, minimumStrokeOpacity, maximumStrokeOpacity, defaultStrokeSmoothingAmount,
    defaultCanvasAspectRatio, mangaPageCanvasAspectRatio, ToolKind, QuickShapeKind,
    quickShapeHoldMilliseconds, quickShapeMorphMilliseconds, quickShapeMinimumDragDistance, quickShapeStationaryDistance,
    quickShapeCurveSamples, quickShapeEllipseSamples, strokeThicknessSteps,
    clampStrokeThickness, getNearestStrokeThicknessStep, clampStrokeOpacity, clampStrokeSmoothingAmount, isBrushTool, isEraserTool,
    add, subtract, multiply, distance, normalize, pathLength, resamplePathPoints, interpolatePointVectors,
    perpendicularDistanceToLine, angleBetween, findFurthestPointFromLine, getMaximumLineError, getBounds, getBoundsCentre,
    projectPointOntoSegment, fitQuadrilateral, fitEllipse, countSharpTurns, classifyQuickShape,
    makeLinePoints, transformPointsFromStartToDrag, getAngleCornerPoint, makeAnglePoints, getForwardTangent, getBackwardTangent,
    appendCubicBezierSegment, makeCurvePointsToEnd, makeCurvePoints, makeRectanglePoints, makeEllipsePoints, makeQuickShapePoints,
    quickShapeHasSharpCorners,
  };
})();
