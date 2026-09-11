/*
 * topojson-lite — the ~1% of topojson-client the Flight Map widget needs:
 * turn a quantised TopoJSON Topology object into plain GeoJSON-ish rings in
 * [lon, lat] order. No projection, no meshing, no npm dependency.
 *
 * Handles: transform (scale/translate) + delta-decoded arcs, Polygon /
 * MultiPolygon / (Multi)LineString geometries, negative arc indices
 * (reversed shared arcs), and GeometryCollection.
 *
 * window.TopoLite.decode(topology, objectName) -> {
 *   polygons: [ [ [ [lon,lat], ... ] ,  ...holes ], ... ],   // for fills
 *   lines:    [ [ [lon,lat], ... ], ... ]                     // for strokes
 * }
 */
(function () {
  'use strict';

  function absoluteArcs(topology) {
    // Decode every arc once from delta form to absolute [x,y] in the
    // topology's own (possibly quantised) coordinate space.
    return topology.arcs.map(function (arc) {
      var out = [];
      var x = 0, y = 0;
      for (var i = 0; i < arc.length; i++) {
        x += arc[i][0];
        y += arc[i][1];
        out.push([x, y]);
      }
      return out;
    });
  }

  function makeTransform(topology) {
    var t = topology.transform;
    if (!t) return function (p) { return [p[0], p[1]]; };
    var kx = t.scale[0], ky = t.scale[1], dx = t.translate[0], dy = t.translate[1];
    return function (p) { return [p[0] * kx + dx, p[1] * ky + dy]; };
  }

  function stitch(arcs, arcIndexList, tf) {
    // arcIndexList is a ring: a list of arc indices, each possibly ~i for
    // "arc i, reversed". Concatenate into one coordinate list, dropping the
    // duplicated shared endpoint between consecutive arcs.
    var coords = [];
    for (var k = 0; k < arcIndexList.length; k++) {
      var idx = arcIndexList[k];
      var reversed = idx < 0;
      var arc = arcs[reversed ? ~idx : idx];
      if (!arc) continue;
      var pts = reversed ? arc.slice().reverse() : arc;
      for (var j = 0; j < pts.length; j++) {
        if (k > 0 && j === 0) continue; // shared endpoint
        coords.push(tf(pts[j]));
      }
    }
    return coords;
  }

  function decode(topology, objectName) {
    var obj = topology.objects && topology.objects[objectName];
    var result = { polygons: [], lines: [] };
    if (!obj) return result;
    var arcs = absoluteArcs(topology);
    var tf = makeTransform(topology);

    function handle(geom) {
      if (!geom) return;
      switch (geom.type) {
        case 'GeometryCollection':
          (geom.geometries || []).forEach(handle);
          break;
        case 'Polygon':
          result.polygons.push(geom.arcs.map(function (ring) { return stitch(arcs, ring, tf); }));
          break;
        case 'MultiPolygon':
          (geom.arcs || []).forEach(function (poly) {
            result.polygons.push(poly.map(function (ring) { return stitch(arcs, ring, tf); }));
          });
          break;
        case 'LineString':
          result.lines.push(stitch(arcs, geom.arcs, tf));
          break;
        case 'MultiLineString':
          (geom.arcs || []).forEach(function (line) { result.lines.push(stitch(arcs, line, tf)); });
          break;
        default:
          break;
      }
    }
    handle(obj);
    return result;
  }

  window.TopoLite = { decode: decode };
})();
