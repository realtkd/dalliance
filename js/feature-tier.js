/* -*- mode: javascript; c-basic-offset: 4; indent-tabs-mode: nil -*- */

// 
// Dalliance Genome Explorer
// (c) Thomas Down 2006-2010
//
// feature-tier.js: renderers for glyphic data
//

var MIN_FEATURE_PX = 1; // FIXME: slightly higher would be nice, but requires making
                        // drawing of joined-up groups a bit smarter.   

var MIN_PADDING = 4;

//
// Colour handling
//

function DColour(red, green, blue, name) {
    this.red = red|0;
    this.green = green|0;
    this.blue = blue|0;
    if (name) {
	this.name = name;
    }
}

DColour.prototype.toSvgString = function() {
    if (!this.name) {
	this.name = "rgb(" + this.red + "," + this.green + "," + this.blue + ")";
    }

    return this.name;
}

var palette = {
    red: new DColour(255, 0, 0, 'red'),
    green: new DColour(0, 255, 0, 'green'),
    blue: new DColour(0, 0, 255, 'blue'),
    yellow: new DColour(255, 255, 0, 'yellow'),
    white: new DColour(255, 255, 255, 'white'),
    black: new DColour(0, 0, 0, 'black')
};

function dasColourForName(name) {
    var c = palette[name];
    if (!c) {
	alert("couldn't handle color: " + name);
    }
    return c;
}

// 
// Wrapper for glyph plus metrics
//

function DGlyph(glyph, min, max, height) {
    this.glyph = glyph;
    this.min = min;
    this.max = max;
    this.height = height;
    this.zindex = 0;
}

//
// Set of bumped glyphs
// 

function DSubTier() {
    this.glyphs = [];
    this.height = 0;
}

DSubTier.prototype.add = function(glyph) {
    this.glyphs.push(glyph);
    this.height = Math.max(this.height, glyph.height);
}

DSubTier.prototype.hasSpaceFor = function(glyph) {
    for (var i = 0; i < this.glyphs.length; ++i) {
	var g = this.glyphs[i];
	if (g.min <= glyph.max && g.max >= glyph.min) {
	    return false;
	}
    }
    return true;
}



function drawLine(featureGroupElement, features, style, tier, y)
{
    var height = style.HEIGHT || 30;
    var min = tier.source.opts.forceMin || style.MIN || 0, max = tier.source.opts.forceMax || style.MAX || 100;
    var yscale = ((1.0 * height) / (max - min));
    var width = style.LINEWIDTH || 1;
    var color = style.COLOR || style.COLOR1 || 'black';

    var path = document.createElementNS(NS_SVG, 'path');
    path.setAttribute("fill", "none");
    path.setAttribute('stroke', color);
    path.setAttribute("stroke-width", width);
    var pathOps = '';

    for (var fi = 0; fi < features.length; ++fi) {
	var f = features[fi];

	var px = ((((f.min|0) + (f.max|0)) / 2) - origin) * scale;
        var sc = ((f.score - (1.0*min)) * yscale)|0;
	var py = y + (height - sc);
	if (fi == 0) {
	    pathOps = 'M ' + px + ' ' + py;
	} else {
	    pathOps += ' L ' + px + ' ' + py;
	}	
    }
    path.setAttribute('d', pathOps);
    featureGroupElement.appendChild(path);

    var clipId = 'line_clip_' + (++clipIdSeed);
    var clip = document.createElementNS(NS_SVG, 'clipPath');
    clip.setAttribute('id', clipId);
    var clipRect = document.createElementNS(NS_SVG, 'rect');
    clipRect.setAttribute('x', -500000);
    clipRect.setAttribute('y', y - 1);
    clipRect.setAttribute('width', 1000000);
    clipRect.setAttribute('height', height + 2);
    clip.appendChild(clipRect);
    featureGroupElement.appendChild(clip);
    path.setAttribute('clip-path', 'url(#' + clipId + ')');
   
    tier.isQuantitative = true;
    tier.min = min;
    tier.max = max;
    tier.clientMin = y|0 + height;
    tier.clientMax = y;

    return height|0 + MIN_PADDING;
}


function sortFeatures(tier)
{
    var ungroupedFeatures = {};
    var groupedFeatures = {};
    var groups = {};
    var superGroups = {};
    var groupsToSupers = {};
    var nonPositional = [];
    
    for (var fi = 0; fi < tier.currentFeatures.length; ++fi) {
	var f = tier.currentFeatures[fi];

        if (!f.min || !f.max) {
            nonPositional.push(f);
            continue;
        }    

	var fGroups = [];
	var fSuperGroup = null;
	if (f.groups) {
	    for (var gi = 0; gi < f.groups.length; ++gi) {
	        var g = f.groups[gi];
		var gid = g.id;
		if (g.type == 'gene') {
		    // Like a super-grouper...
		    fSuperGroup = gid; 
		    groups[gid] = g;
		} else if (g.type == 'translation') {
		    // have to ignore this to get sensible results from bj-e :-(.
		} else {
		    pusho(groupedFeatures, gid, f);
	            groups[gid] = g;
		    fGroups.push(gid);
	        }
	    }
	}

	if (fGroups.length == 0) {
	    pusho(ungroupedFeatures, f.type, f);
	} else if (fSuperGroup) {
	    for (var g = 0; g < fGroups.length; ++g) {
		var gid = fGroups[g];
		pushnewo(superGroups, fSuperGroup, gid);
		groupsToSupers[gid] = fSuperGroup;
	    } 
	}	
    }

    tier.ungroupedFeatures = ungroupedFeatures;
    tier.groupedFeatures = groupedFeatures;
    tier.groups = groups;
    tier.superGroups = superGroups;
    tier.groupsToSupers = groupsToSupers;
}

var clipIdSeed = 0;

function drawFeatureTier(tier)
{
    sortFeatures(tier);
    tier.placard = null;
    tier.isQuantitative = false;         // gets reset later if we have any HISTOGRAMs.

    var featureGroupElement = tier.viewport;
    while (featureGroupElement.childNodes.length > 0) {
	featureGroupElement.removeChild(featureGroupElement.firstChild);
    }
    featureGroupElement.appendChild(tier.background);
    drawGuidelines(featureGroupElement);
	
    var lh = MIN_PADDING;
    var bumpMatrix = null;
    if (tier.bumped) {
	bumpMatrix = new Array(0);
    }
    var styles = tier.styles(scale);

    var glyphs = [];
    var specials = false;

    // Glyphify ungrouped.
	
    for (var uft in tier.ungroupedFeatures) {
	var ufl = tier.ungroupedFeatures[uft];
	var style = styles[uft] || styles['default'];
	if (!style) continue;
	if (style.glyph == 'LINEPLOT') {
	    lh += Math.max(drawLine(featureGroupElement, ufl, style, tier, lh));
	    specials = true;
	} else {
	    for (var pgid = 0; pgid < ufl.length; ++pgid) {
		var g = glyphForFeature(ufl[pgid], 0, style, tier);
		glyphs.push(g);
	    }
	}
    }

    // Merge supergroups
    
    if (tier.source.opts.collapseSuperGroups && !tier.bumped) {
	for (var sg in tier.superGroups) {
	    var sgg = tier.superGroups[sg];
	    var featsByType = {};
	    for (var g = 0; g < sgg.length; ++g) {
		var gf = tier.groupedFeatures[sgg[g]];
		for (var fi = 0; fi < gf.length; ++fi) {
		    var f = gf[fi];
		    pusho(featsByType, f.type, f);
		}

		if (tier.groups[sg] && !tier.groups[sg].links || tier.groups[sg].links.length == 0) {
		    tier.groups[sg].links = tier.groups[sgg[0]].links;
		}

		delete tier.groupedFeatures[sgg[g]];  // 'cos we don't want to render the unmerged version.
	    }

	    for (var t in featsByType) {
		var feats = featsByType[t];
		var template = feats[0];
		var loc = null;
		for (var fi = 0; fi < feats.length; ++fi) {
		    var f = feats[fi];
		    var fl = new Range(f.min, f.max);
		    if (!loc) {
			loc = fl;
		    } else {
			loc = union(loc, fl);
		    }
		}
		var mergedRanges = loc.ranges();
		for (var si = 0; si < mergedRanges.length; ++si) {
		    var r = mergedRanges[si];

		    // begin coverage-counting
		    var posCoverage = ((r.max()|0) - (r.min()|0) + 1) * sgg.length;
		    var actCoverage = 0;
		    for (var fi = 0; fi < feats.length; ++fi) {
			var f = feats[fi];
			if ((f.min|0) <= r.max() && (f.max|0) >= r.min()) {
			    var umin = Math.max(f.min|0, r.min());
			    var umax = Math.min(f.max|0, r.max());
			    actCoverage += (umax - umin + 1);
			}
		    }
		    var visualWeight = ((1.0 * actCoverage) / posCoverage);
		    // end coverage-counting

		    var newf = new DASFeature();
		    for (k in template) {
			newf[k] = template[k];
		    }
		    newf.min = r.min();
		    newf.max = r.max();
		    if (newf.label && sgg.length > 1) {
			newf.label += ' (' + sgg.length + ' vars)';
		    }
		    newf.visualWeight = ((1.0 * actCoverage) / posCoverage);
		    pusho(tier.groupedFeatures, sg, newf);
		    // supergroups are already in tier.groups.
		}
	    }

	    delete tier.superGroups[sg]; // Do we want this?
	}	
    }

    // Glyphify groups.

    var gl = new Array();
    for (var gid in tier.groupedFeatures) {
	gl.push(gid);
    }
    gl.sort(function(g1, g2) {
	var d = tier.groupedFeatures[g1][0].score - tier.groupedFeatures[g2][0].score;
	if (d > 0) {
	    return -1;
        } else if (d = 0) {
	    return 0;
        } else {
	    return 1;
        }
    });

    var groupGlyphs = {};
    for (var gx in gl) {
	var gid = gl[gx];
	var g = glyphsForGroup(tier.groupedFeatures[gid], 0, styles, tier.groups[gid], tier,
			       (tier.source.opts.collapseSuperGroups && !tier.bumped) ? 'collapsed_gene' : 'tent');
	groupGlyphs[gid] = g;
    }

    for (var sg in tier.superGroups) {
	var sgg = tier.superGroups[sg];
	var sgGlyphs = [];
	var sgMin = 10000000000;
	var sgMax = -10000000000;
	for (var sgi = 0; sgi < sgg.length; ++sgi) {
	    var gg = groupGlyphs[sgg[sgi]];
	    groupGlyphs[sgg[sgi]] = null;
	    if (gg) {
		sgGlyphs.push(gg);
		sgMin = Math.min(sgMin, gg.min);
		sgMax = Math.max(sgMax, gg.max);
	    }
	}
	for (var sgi = 0; sgi < sgGlyphs.length; ++sgi) {
	    var gg = sgGlyphs[sgi];
	    gg.min = sgMin;
	    gg.max = sgMax;
	    glyphs.push(gg);
	}
    }
    for (var g in groupGlyphs) {
	var gg = groupGlyphs[g];
	if (gg) {
	    glyphs.push(gg);
	}
    }

    var unbumpedST = new DSubTier();
    var bumpedSTs = [];
    var hasBumpedFeatures = false;
    
  GLYPH_LOOP:
    for (var i = 0; i < glyphs.length; ++i) {
	var g = glyphs[i];
	g = labelGlyph(g, featureGroupElement);
        if (g.bump) {
            hasBumpedFeatures = true;
        }
	if (g.bump && (tier.bumped || tier.source.opts.collapseSuperGroups)) {       // kind-of nasty.  supergroup collapsing is different from "normal" unbumping
	    for (var sti = 0; sti < bumpedSTs.length;  ++sti) {
		var st = bumpedSTs[sti];
		if (st.hasSpaceFor(g)) {
		    st.add(g);
		    continue GLYPH_LOOP;
		}
	    }
	    var st = new DSubTier();
	    st.add(g);
	    bumpedSTs.push(st);
	} else {
	    unbumpedST.add(g);
	}
    }

    tier.hasBumpedFeatures = hasBumpedFeatures;

    if (unbumpedST.glyphs.length > 0) {
	bumpedSTs = [unbumpedST].concat(bumpedSTs);
    }

    var stBoundaries = [];
    if (specials) {
	stBoundaries.push(lh);
    } 
    for (var bsi = 0; bsi < bumpedSTs.length; ++bsi) {
	var st = bumpedSTs[bsi];
        var stg = st.glyphs;
        stg = stg.sort(function(g1, g2) {
            return g1.zindex - g2.zindex;
        });

	for (var i = 0; i < stg.length; ++i) {
	    var g = stg[i];
	    if (g.glyph) {
		g.glyph.setAttribute('transform', 'translate(0, ' + lh + ')');
		featureGroupElement.appendChild(g.glyph);
	    }
	}
        
        if (g.quant) {
            tier.isQuantitative = true;
            tier.min = g.quant.min;
            tier.max = g.quant.max;
            tier.clientMin = lh + st.height;
            tier.clientMax = lh;
        }

	lh += st.height + MIN_PADDING;
	stBoundaries.push(lh);
    }

    lh = Math.max(minTierHeight, lh); // for sanity's sake.
    if (stBoundaries.length < 2) {
	var bumped = false;
	var minHeight = lh;
	for (s in styles) {
	    if (s.bump) {
		bumped = true;
	    }
	    if (s.height && (4.0 + s.height) > minHeight) {
		minHeight = (4.0 + s.height);
	    }
	}
	if (bumped) {
	    lh = 2 * minHeight;
	}
    }				

    if (!tier.layoutWasDone || autoSizeTiers) {
	tier.layoutHeight = lh;
	tier.background.setAttribute("height", lh);
	if (glyphs.length > 0 || specials) {
	    tier.layoutWasDone = true;
	}
	tier.placard = null;
    } else {
	if (tier.layoutHeight != lh) {
	    var spandPlacard = document.createElementNS(NS_SVG, 'g');
	    var frame = document.createElementNS(NS_SVG, 'rect');
	    frame.setAttribute('x', 0);
	    frame.setAttribute('y', -20);
	    frame.setAttribute('width', featurePanelWidth);
	    frame.setAttribute('height', 20);
	    frame.setAttribute('stroke', 'red');
	    frame.setAttribute('stroke-width', 1);
	    frame.setAttribute('fill', 'white');
	    spandPlacard.appendChild(frame);
	    var spand = document.createElementNS(NS_SVG, 'text');
	    spand.setAttribute('stroke', 'none');
	    spand.setAttribute('fill', 'red');
	    spand.setAttribute('font-family', 'helvetica');
	    spand.setAttribute('font-size', '10pt');

	    if (tier.layoutHeight < lh) { 
		var dispST = 0;
		while ((tier.layoutHeight - 20) >= stBoundaries[dispST]) { // NB allowance for placard!
		    ++dispST;
		}
		spand.appendChild(document.createTextNode('Show ' + (stBoundaries.length - dispST) + ' more'));
	    } else {
		spand.appendChild(document.createTextNode('Show less'));
	    }
	    
	    spand.setAttribute('x', 80);
	    spand.setAttribute('y', -6);
	    spandPlacard.appendChild(spand);
	    var arrow = document.createElementNS(NS_SVG, 'path');
	    arrow.setAttribute('fill', 'red');
	    arrow.setAttribute('stroke', 'none');
	    if (tier.layoutHeight < lh) {
		arrow.setAttribute('d', 'M ' +  30 + ' ' + -16 +
				   ' L ' + 42 + ' ' + -16 +
				   ' L ' + 36 + ' ' + -4 + ' Z');
	    } else {
		arrow.setAttribute('d', 'M ' +  30 + ' ' + -4 +
				   ' L ' + 42 + ' ' + -4 +
				   ' L ' + 36 + ' ' + -16 + ' Z');
	    }
	    spandPlacard.appendChild(arrow);
	    
	    spandPlacard.addEventListener('mousedown', function(ev) {
		tier.layoutWasDone = false;
		drawFeatureTier(tier);
		arrangeTiers();
	    }, false);

	    var dismiss = document.createElementNS(NS_SVG, 'text');
	    dismiss.setAttribute('stroke', 'none');
	    dismiss.setAttribute('fill', 'red');
	    dismiss.setAttribute('font-family', 'helvetica');
	    dismiss.setAttribute('font-size', '10pt');
	    dismiss.appendChild(document.createTextNode("(Auto grow-shrink)"));
	    dismiss.setAttribute('x', 750);
	    dismiss.setAttribute('y', -6);
	    dismiss.addEventListener('mousedown', function(ev) {
		ev.preventDefault(); ev.stopPropagation();
		autoSizeTiers = true;
		refresh();
	    }, false);
	    spandPlacard.appendChild(dismiss);

	    tier.placard = spandPlacard;
	} 
    }

    var statusMsg = tier.error || tier.status;
    if (statusMsg != null) {
	var statusPlacard = document.createElementNS(NS_SVG, 'g');
	var frame = document.createElementNS(NS_SVG, 'rect');
	frame.setAttribute('x', 0);
	frame.setAttribute('y', -20);
	frame.setAttribute('width', featurePanelWidth);
	frame.setAttribute('height', 20);
	frame.setAttribute('stroke', 'red');
	frame.setAttribute('stroke-width', 1);
	frame.setAttribute('fill', 'white');
	statusPlacard.appendChild(frame);
	var status = document.createElementNS(NS_SVG, 'text');
	status.setAttribute('stroke', 'none');
	status.setAttribute('fill', 'red');
	status.setAttribute('font-family', 'helvetica');
	status.setAttribute('font-size', '10pt');
	status.setAttribute('x', 80);
	status.setAttribute('y', -6);
	status.appendChild(document.createTextNode(statusMsg));
	statusPlacard.appendChild(status);
	tier.placard = statusPlacard;
    }

    var clipId = 'tier_clip_' + (++clipIdSeed);
    var clip = document.createElementNS(NS_SVG, 'clipPath');
    clip.setAttribute('id', clipId);
    var clipRect = document.createElementNS(NS_SVG, 'rect');
    clipRect.setAttribute('x', -500000);
    clipRect.setAttribute('y', 0);
    clipRect.setAttribute('width', 1000000);
    clipRect.setAttribute('height', tier.layoutHeight);
    clip.appendChild(clipRect);
    featureGroupElement.appendChild(clip);
    featureGroupElement.setAttribute('clip-path', 'url(#' + clipId + ')');
	    
    tier.scale = 1;
}

function glyphsForGroup(features, y, stylesheet, groupElement, tier, connectorType) {
    var height=1;
    var label;
    var links = null;
    var notes = null;
    var spans = null;
    var strand = null;
  
    var glyphGroup = document.createElementNS(NS_SVG, 'g');
    glyphGroup.dalliance_group = groupElement;
    var featureDGlyphs = [];
    for (var i = 0; i < features.length; ++i) {
	var feature = features[i];
	if (feature.orientation && strand==null) {
	    strand = feature.orientation;
	}
	if (feature.notes && notes==null) {
	    notes = feature.notes;
	}
	if (feature.links && links==null) {
	    links = feature.links;
	}
	var style = stylesheet[feature.type] || stylesheet['default'];
	if (!style) {
	    continue;
	}
	var glyph = glyphForFeature(feature, y, style, tier);
        if (glyph && glyph.glyph) {
            featureDGlyphs.push(glyph);
        }
    }
    featureDGlyphs = featureDGlyphs.sort(function(g1, g2) {
        return g1.zindex - g2.zindex;
    });
    
    for (var i = 0; i < featureDGlyphs.length; ++i) {
        var glyph = featureDGlyphs[i];
        glyph.glyph.dalliance_group = groupElement;
	glyphGroup.appendChild(glyph.glyph);
	var gspan = new Range(glyph.min, glyph.max);
	if (spans == null) {
	    spans = gspan;
	} else {
	    spans = union(spans, gspan);
	}
	height = Math.max(height, glyph.height);
	if (!label && glyph.label) {
	    label = glyph.label;
	}
    }

    if (spans) {
	var blockList = spans.ranges();
	for (var i = 1; i < blockList.length; ++i) {
	    var lmin = (blockList[i - 1].max() - origin) * scale;
	    var lmax = (blockList[i].min() - origin) * scale;

            var path;
	    if (connectorType == 'collapsed_gene') {
		path = document.createElementNS(NS_SVG, 'path');
		path.setAttribute('fill', 'none');
		path.setAttribute('stroke-width', '1');
		
		var pathops = "M " + lmin + " " + (y + 6) + " L " + lmax + " " + (y + 6);
		if (lmax - lmin > 8) {
		    var lmid = (0.5*lmax) + (0.5*lmin);
		    if (strand == '+') {
			pathops += ' M ' + (lmid - 2) + ' ' + (y+6-4) +
			    ' L ' + (lmid + 2) + ' ' + (y+6) +
			    ' L ' + (lmid - 2) + ' ' + (y+6+4); 
		    } else if (strand == '-') {
			pathops += ' M ' + (lmid + 2) + ' ' + (y+6-4) +
			    ' L ' + (lmid - 2) + ' ' + (y+6) +
			    ' L ' + (lmid + 2) + ' ' + (y+6+4); 
		    }
		}
		path.setAttribute('d', pathops);
	    } else {
		path = document.createElementNS(NS_SVG, 'path');
		path.setAttribute('fill', 'none');
		path.setAttribute('stroke-width', '1');
		
		if (strand == "+" || strand == "-") {
		    var lmid = (lmin + lmax) / 2;
		    var lmidy = (strand == "-") ? y + 12 : y;
		    path.setAttribute("d", "M " + lmin + " " + (y + 6) + " L " + lmid + " " + lmidy + " L " + lmax + " " + (y + 6));
		} else {
		    path.setAttribute("d", "M " + lmin + " " + (y + 6) + " L " + lmax + " " + (y + 6));
		}
	    }
	    glyphGroup.appendChild(path);
	}
    }

    groupElement.segment = features[0].segment;
    groupElement.min = spans.min();
    groupElement.max = spans.max();
    if (notes && !groupElement.notes || groupElement.notes.length==0) {
        groupElement.notes = notes;
    }

    var dg = new DGlyph(glyphGroup, spans.min(), spans.max(), height);
    dg.strand = strand;
    dg.bump = true; // grouped features always bumped.
    if (label) {
	dg.label = label;
	var sg = tier.groupsToSupers[groupElement.id];
	if (sg && tier.superGroups[sg]) {    // workaround case where group and supergroup IDs match.
	    if (groupElement.id != tier.superGroups[sg][0]) {
	    	dg.label = null;
	    }
	}
    }
    return dg;
}

function glyphForFeature(feature, y, style, tier)
{
    var gtype = style.glyph || 'BOX';
    var glyph;

    var min = feature.min;
    var max = feature.max;
    var type = feature.type;
    var strand = feature.orientation;
    var score = feature.score;
    var label = feature.label;

    var minPos = (min - origin) * scale;
    var maxPos = (max - origin) * scale;

    var requiredHeight;
    var quant;

    if (gtype == 'HIDDEN') {
	glyph = null;
    } else if (gtype == 'CROSS' || gtype == 'EX' || gtype == 'SPAN' || gtype == 'LINE' || gtype == 'DOT' || gtype == 'TRIANGLE') {
	var stroke = style.FGCOLOR || 'black';
	var fill = style.BGCOLOR || 'none';
	var height = style.HEIGHT || 12;
	requiredHeight = height = 1.0 * height;

	var mid = (minPos + maxPos)/2;
	var hh = height/2;

	var mark;
        var bMinPos = minPos, bMaxPos = maxPos;

	if (gtype == 'CROSS') {
	    mark = document.createElementNS(NS_SVG, 'path');
	    mark.setAttribute('fill', 'none');
	    mark.setAttribute('stroke', stroke);
	    mark.setAttribute('stroke-width', 1);
	    mark.setAttribute('d', 'M ' + (mid-hh) + ' ' + (y+hh) + 
			      ' L ' + (mid+hh) + ' ' + (y+hh) + 
			      ' M ' + mid + ' ' + y +
			      ' L ' + mid + ' ' + (y+height));
            bMinPos = Math.min(minPos, mid-hh);
            bMaxPos = Math.max(maxPos, mid+hh);
	} else if (gtype == 'EX') {
	    mark = document.createElementNS(NS_SVG, 'path');
	    mark.setAttribute('fill', 'none');
	    mark.setAttribute('stroke', stroke);
	    mark.setAttribute('stroke-width', 1);
	    mark.setAttribute('d', 'M ' + (mid-hh) + ' ' + (y) + 
			      ' L ' + (mid+hh) + ' ' + (y+height) + 
			      ' M ' + (mid+hh) + ' ' + (y) +
			      ' L ' + (mid-hh) + ' ' + (y+height));  
            bMinPos = Math.min(minPos, mid-hh);
            bMaxPos = Math.max(maxPos, mid+hh);
	} else if (gtype == 'SPAN') {
	    mark = document.createElementNS(NS_SVG, 'path');
	    mark.setAttribute('fill', 'none');
	    mark.setAttribute('stroke', stroke);
	    mark.setAttribute('stroke-width', 1);
	    mark.setAttribute('d', 'M ' + minPos + ' ' + (y+hh) +
			      ' L ' + maxPos + ' ' + (y+hh) +
			      ' M ' + minPos + ' ' + y +
			      ' L ' + minPos + ' ' + (y + height) +
			      ' M ' + maxPos + ' ' + y +
			      ' L ' + maxPos + ' ' + (y + height));
	} else if (gtype == 'LINE') {
	    var lstyle = style.STYLE || 'solid';
	    mark = document.createElementNS(NS_SVG, 'path');
	    mark.setAttribute('fill', 'none');
	    mark.setAttribute('stroke', stroke);
	    mark.setAttribute('stroke-width', 1);
	    if (lstyle == 'hat') {
		var dip = 0;
		if (feature.orientation == '-') {
		    dip = height;
		}
		mark.setAttribute('d', 'M ' + minPos + ' ' + (y+hh) +
				  ' L ' + ((maxPos + minPos) / 2) + ' ' + (y+dip) +
				  ' L ' + maxPos + ' ' + (y+hh));
	    } else {
		mark.setAttribute('d', 'M ' + minPos + ' ' + (y+hh) +
				  ' L ' + maxPos + ' ' + (y+hh));
	    }
	    if (lstyle == 'dashed') {
		mark.setAttribute('stroke-dasharray', '3');
	    }
	} else if (gtype == 'DOT') {
	    mark = document.createElementNS(NS_SVG, 'circle');
	    mark.setAttribute('fill', stroke);   // yes, really...
	    mark.setAttribute('stroke', 'none');
	    mark.setAttribute('cx', mid);
	    mark.setAttribute('cy', (y+hh));
	    mark.setAttribute('r', hh);
            bMinPos = Math.min(minPos, mid-hh);
            bMaxPos = Math.max(maxPos, mid+hh);
	}  else if (gtype == 'TRIANGLE') {
	    var dir = style.DIRECTION || 'N';
	    var width = style.LINEWIDTH || height;
	    halfHeight = 0.5 * height;
	    halfWidth = 0.5 * width;
	    mark = document.createElementNS(NS_SVG, 'path');
	    if (dir == 'E') {
	    mark.setAttribute('d', 'M ' + (mid - halfWidth) + ' ' + 0 + 
			      ' L ' + (mid - halfWidth) + ' ' + height +
			      ' L ' + (mid + halfWidth) + ' ' + halfHeight + ' Z');
	    } else if (dir == 'W') {
		mark.setAttribute('d', 'M ' + (mid + halfWidth) + ' ' + 0 + 
				  ' L ' + (mid + halfWidth) + ' ' + height +
				  ' L ' + (mid - halfWidth) + ' ' + halfHeight + ' Z');
	    } else if (dir == 'S') {
		mark.setAttribute('d', 'M ' + (mid + halfWidth) + ' ' + 0 + 
				  ' L ' + (mid - halfWidth) + ' ' + 0 +
				  ' L ' + mid + ' ' + height + ' Z');
	    } else {
		mark.setAttribute('d', 'M ' + (mid + halfWidth) + ' ' + height + 
				  ' L ' + (mid - halfWidth) + ' ' + height +
				  ' L ' + mid + ' ' + 0 + ' Z');
	    }
            bMinPos = Math.min(minPos, mid-halfWidth);
            bMaxPos = Math.max(maxPos, mid+halfWidth);
	    mark.setAttribute('fill', stroke);
	    mark.setAttribute('stroke', 'none');
	}

	glyph = document.createElementNS(NS_SVG, 'g');
        if (fill == 'none' || bMinPos < minPos || bMaxPos > maxPos) {
            var bg = document.createElementNS(NS_SVG, 'rect');
	    bg.setAttribute('x', bMinPos);
            bg.setAttribute('y', y);
            bg.setAttribute('width', bMaxPos - bMinPos);
            bg.setAttribute('height', height);
	    bg.setAttribute('stroke', 'none');
	    bg.setAttribute('fill', 'none');
            bg.setAttribute('pointer-events', 'all');
	    glyph.appendChild(bg);
        }
        if (fill != 'none') {
	    var bg = document.createElementNS(NS_SVG, 'rect');
	    bg.setAttribute('x', minPos);
            bg.setAttribute('y', y);
            bg.setAttribute('width', maxPos - minPos);
            bg.setAttribute('height', height);
	    bg.setAttribute('stroke', 'none');
	    bg.setAttribute('fill', fill);
            bg.setAttribute('pointer-events', 'all');
	    glyph.appendChild(bg);
        }
	glyph.appendChild(mark);
    } else if (gtype == 'PRIMERS') {
	var arrowColor = style.FGCOLOR || 'red';
	var lineColor = style.BGCOLOR || 'black';
	var height = style.HEIGHT || 12;
	requiredHeight = height = 1.0 * height;

	var mid = (minPos + maxPos)/2;
	var hh = height/2;

	var glyph = document.createElementNS(NS_SVG, 'g');
	var line = document.createElementNS(NS_SVG, 'path');
	line.setAttribute('stroke', lineColor);
	line.setAttribute('fill', 'none');
	line.setAttribute('d', 'M ' + minPos + ' ' + (height/2) + ' L ' + maxPos + ' ' + (height/2));
	glyph.appendChild(line);

	var trigs = document.createElementNS(NS_SVG, 'path');
	trigs.setAttribute('stroke', 'none');
	trigs.setAttribute('fill', 'arrowColor');
	trigs.setAttribute('d', 'M ' + minPos + ' ' + 0 + ' L ' + minPos + ' ' + height + ' L ' + (minPos + height) + ' ' + (height/2) + ' Z ' +
	    		        'M ' + maxPos + ' ' + 0 + ' L ' + maxPos + ' ' + height + ' L ' + (maxPos - height) + ' ' + (height/2) + ' Z');
	glyph.appendChild(trigs);
    } else if (gtype == 'ARROW') {
        var parallel = style.PARALLEL ? style.PARALLEL == 'yes' : true;
        var ne = style.NORTHEAST && style.NORTHEAST == 'yes';
        var sw = style.SOUTHWEST && style.SOUTHWEST == 'yes';

	var stroke = style.FGCOLOR || 'none';
	var fill = style.BGCOLOR || 'green';
	var height = style.HEIGHT || 12;
	requiredHeight = height = 1.0 * height;
	var headInset = parallel ? 0.5 *height : 0.25 * height;
	var midPos = (maxPos + minPos)/2;
	var instep = parallel ? 0.25 * height : 0.4 * height;
	
        if (parallel) {
            if (ne && (maxPos - midPos < height)) {
                maxPos = midPos + height;
            }
            if (sw && (midPos - minPos < height)) {
                minPos = midPos - height;
            }
        } else {
            if (maxPos - minPos < (0.75 * height)) {
                minPos = midPos - (0.375 * height);
                maxPos = midPos + (0.375 * height);
            }
        }

	var path = document.createElementNS(NS_SVG, 'path');
	path.setAttribute('fill', fill);
	path.setAttribute('stroke', stroke);
	if (stroke != 'none') {
	    path.setAttribute('stroke-width', 1);
	}

        var pathops;
        if (parallel) {
            pathops = 'M ' + midPos + ' ' + instep;
            if (ne) {
                pathops += ' L ' + (maxPos - headInset) + ' ' + instep + 
                    ' L ' + (maxPos - headInset) + ' 0' +
                    ' L ' + maxPos + ' ' + (height/2) +
                    ' L ' + (maxPos - headInset) + ' ' + height +
                    ' L ' + (maxPos - headInset) + ' ' + (height - instep);
            } else {
                pathops += ' L ' + maxPos + ' ' + instep +
                    ' L ' + maxPos + ' ' + (height - instep);
            }
            if (sw) {
                pathops += ' L ' + (minPos + headInset) + ' ' + (height-instep) +
                    ' L ' + (minPos + headInset) + ' ' + height + 
                    ' L ' + minPos + ' ' + (height/2) +
                    ' L ' + (minPos + headInset) + ' ' + ' 0' +
                    ' L ' + (minPos + headInset) + ' ' + instep;
            } else {
                pathops += ' L ' + minPos + ' ' + (height-instep) +
                    ' L ' + minPos + ' ' + instep;
            }
            pathops += ' Z';
        } else {
            pathops = 'M ' + (minPos + instep) + ' ' + (height/2);
            if (ne) {
                pathops += ' L ' + (minPos + instep) + ' ' + headInset +
                    ' L ' + minPos + ' ' + headInset +
                    ' L ' + midPos + ' 0' +
                    ' L ' + maxPos + ' ' + headInset +
                    ' L ' + (maxPos - instep) + ' ' + headInset;
            } else {
                pathops += ' L ' + (minPos + instep) + ' 0' +
                    ' L ' + (maxPos - instep) + ' 0';
            }
            if (sw) {
                pathops += ' L ' + (maxPos - instep) + ' ' + (height - headInset) +
                    ' L ' + maxPos + ' ' + (height - headInset) +
                    ' L ' + midPos + ' ' + height + 
                    ' L ' + minPos + ' ' + (height - headInset) +
                    ' L ' + (minPos + instep) + ' ' + (height - headInset);
            } else {
                pathops += ' L ' + (maxPos - instep) + ' ' + height +
                    ' L ' + (minPos + instep) + ' ' + height;
            }
            pathops += ' Z';
        }
	path.setAttribute('d', pathops);

	glyph = path;
    } else if (gtype == 'ANCHORED_ARROW') {
	var stroke = style.FGCOLOR || 'none';
	var fill = style.BGCOLOR || 'green';
	var height = style.HEIGHT || 12;
	requiredHeight = height = 1.0 * height;
	var lInset = 0;
	var rInset = 0;
	var minLength = height + 2;
	var instep = 0.333333 * height;
	

	if (feature.orientation) {
	    if (feature.orientation == '+') {
		rInset = height/2;
	    } else if (feature.orientation == '-') {
		lInset = height/2;
	    }
	}

        if (maxPos - minPos < minLength) {
            minPos = (maxPos + minPos - minLength) / 2;
            maxPos = minPos + minLength;
        }

	var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
	path.setAttribute("fill", fill);
	path.setAttribute('stroke', stroke);
	if (stroke != 'none') {
	    path.setAttribute("stroke-width", 1);
	}
	
	path.setAttribute('d', 'M ' + ((minPos + lInset)) + ' ' + ((y+instep)) +
                          ' L ' + ((maxPos - rInset)) + ' ' + ((y+instep)) +
			  ' L ' + ((maxPos - rInset)) + ' ' + (y) +
			  ' L ' + (maxPos) + ' ' + ((y+(height/2))) +
			  ' L ' + ((maxPos - rInset)) + ' ' + ((y+height)) +
			  ' L ' + ((maxPos - rInset)) + ' ' + ((y + instep + instep)) +
			  ' L ' + ((minPos + lInset)) + ' ' + ((y + instep + instep)) +
			  ' L ' + ((minPos + lInset)) + ' ' + ((y + height)) +
			  ' L ' + (minPos) + ' ' + ((y+(height/2))) +
			  ' L ' + ((minPos + lInset)) + ' ' + (y) +
			  ' L ' + ((minPos + lInset)) + ' ' + ((y+instep)));

	glyph = path;
    } else if (gtype == 'TEXT') {
        var textFill = style.FGCOLOR || 'none';
        var bgFill = style.BGCOLOR || 'none';
        var height = style.HEIGHT || 12;
        var tstring = style.STRING;
        requiredHeight = height;
        if (!tstring) {
            glyph = null;
        } else {
            var txt = makeElementNS(NS_SVG, 'text', tstring, {
                stroke: 'none',
                fill: textFill
            });
            tier.viewport.appendChild(txt);
            var bbox = txt.getBBox();
            tier.viewport.removeChild(txt);
            txt.setAttribute('x', (minPos + maxPos - bbox.width)/2);
            txt.setAttribute('y', height - 2);

            if (bgFill == 'none') {
                glyph = txt;
            } else {
                glyph = makeElementNS(NS_SVG, 'g', [
                    makeElementNS(NS_SVG, 'rect', null, {
                        x: minPos,
                        y: 0,
                        width: (maxPos - minPos),
                        height: height,
                        fill: bgFill,
                        stroke: 'none'
                    }),
                    txt]);
            }

            if (bbox.width > (maxPos - minPos)) {
                var tMinPos = (minPos + maxPos - bbox.width)/2;
                var tMaxPos = minPos + bbox.width;
                min = ((tMinPos/scale)|0) + origin;
                max = ((tMaxPos/scale)|0) + origin;
            }
        }
    } else {
	// BOX plus other rectangular stuff
	// Also handles HISTOGRAM, GRADIENT, and TOOMANY.
    
	var stroke = style.FGCOLOR || 'none';
	var fill = style.BGCOLOR || 'green';
	var height = style.HEIGHT || 12;
	requiredHeight = height = 1.0 * height;

        if (maxPos - minPos < MIN_FEATURE_PX) {
            minPos = (maxPos + minPos - MIN_FEATURE_PX) / 2;
            maxPos = minPos + MIN_FEATURE_PX;
        }

	if ((gtype == 'HISTOGRAM' || gtype == 'GRADIENT') && score) {
	    var smin = tier.source.opts.forceMin || style.MIN || 0;
	    var smax = tier.source.opts.forceMax || style.MAX || 100;
	    if ((1.0 * score) < (1.0 *smin)) {
		score = smin;
	    }
	    if ((1.0 * score) > (1.0 * smax)) {
		score = smax;
	    }
	    var relScore = ((1.0 * score) - smin) / (smax-smin);

            if (style.COLOR2) {
	        var loc, hic, frac;
	        if (style.COLOR3) {
		    if (relScore < 0.5) {
		        loc = dasColourForName(style.COLOR1);
		        hic = dasColourForName(style.COLOR2);
		        frac = relScore * 2;
		    } else {
		        loc = dasColourForName(style.COLOR2);
		        hic = dasColourForName(style.COLOR3);
		        frac = (relScore * 2.0) - 1.0;
		    }
	        } else {
		    loc = dasColourForName(style.COLOR1);
		    hic = dasColourForName(style.COLOR2);
		    frac = relScore;
	        }

	        fill = new DColour(
		    ((loc.red * (1.0 - frac)) + (hic.red * frac))|0,
		    ((loc.green * (1.0 - frac)) + (hic.green * frac))|0,
		    ((loc.blue * (1.0 - frac)) + (hic.blue * frac))|0
	        ).toSvgString();
            } 

	    if (gtype == 'HISTOGRAM') {
		height = (height * relScore)|0;
		y = y + (requiredHeight - height);
                
                quant = {
                    min: smin,
                    max: smax
                };
	    }
	}
 
        var rect = document.createElementNS(NS_SVG, 'rect');
        rect.setAttribute('x', minPos);
        rect.setAttribute('y', y);
        rect.setAttribute('width', maxPos - minPos);
        rect.setAttribute('height', height);
	rect.setAttribute('stroke', stroke);
        rect.setAttribute('stroke-width', 1);
	rect.setAttribute('fill', fill);
	
	if (feature.visualWeight && feature.visualWeight < 1.0) {
	    rect.setAttribute('fill-opacity', feature.visualWeight);
	    if (stroke != 'none') {
		rect.setAttribute('stroke-opacity', feature.visualWeight);
	    }
	}
	
        if (gtype == 'TOOMANY') {
            var bits = [rect];
            for (var i = 3; i < height; i += 3) {
                bits.push(makeElementNS(NS_SVG, 'line', null, {
                    x1: minPos,
                    y1: i,
                    x2: maxPos,
                    y2: i,
                    stroke: stroke,
                    strokeWidth: 0.5
                }));
            }
            glyph = makeElementNS(NS_SVG, 'g', bits);
        } else {
	    glyph = rect;
        }
    }

    glyph.dalliance_feature = feature;
    var dg = new DGlyph(glyph, min, max, requiredHeight);
    if (style.LABEL && feature.label) {
	dg.label = feature.label;
    }
    if (style.BUMP) {
	dg.bump = true;
    }
    dg.strand = feature.orientation || '0';
    if (quant) {
        dg.quant = quant;
    }
    dg.zindex = style.ZINDEX || 0;

    return dg;
}

function labelGlyph(dglyph, featureTier) {
    if (dglyph.glyph && dglyph.label) {
	var label = dglyph.label;
	var labelText = document.createElementNS(NS_SVG, 'text');
	labelText.setAttribute('x', (dglyph.min - origin) * scale);
	labelText.setAttribute('y', dglyph.height + 15);
	labelText.setAttribute('stroke-width', 0);
	labelText.setAttribute('fill', 'black');
	labelText.setAttribute('class', 'label-text');
	labelText.setAttribute('font-family', 'helvetica');
	labelText.setAttribute('font-size', '10pt');
	if (dglyph.strand == '+') {
	    label = label + '>';
	} else if (dglyph.strand == '-') {
	    label = '<' + label;
        }
	labelText.appendChild(document.createTextNode(label));

	featureTier.appendChild(labelText);
	var width = labelText.getBBox().width;
	featureTier.removeChild(labelText);

	var g;
	if (dglyph.glyph.localName == 'g') {
	    g = dglyph.glyph;
	} else {
	    g = document.createElementNS(NS_SVG, 'g');
	    g.appendChild(dglyph.glyph);
	}
	g.appendChild(labelText);
	dglyph.glyph = g;
	dglyph.height = dglyph.height + 20;
	
	var textMax = (dglyph.min|0) + ((width + 10) / scale)
	if (textMax > dglyph.max) {
	    var adj = (textMax - dglyph.max)/2;
	    var nmin = ((dglyph.min - adj - origin) * scale) + 5;
	    labelText.setAttribute('x', nmin)
	    dglyph.min = ((nmin/scale)+origin)|0;
	    dglyph.max = (textMax-adj)|0;
	} else {
	}
    }
    return dglyph;
}