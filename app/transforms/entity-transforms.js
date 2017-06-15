/*
 * Copyright 2017 Next Century Corporation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* exported entityTransforms */
/* jshint camelcase:false */

var entityTransforms = (function(_, commonTransforms) {
  function getSingleStringFromResult(result, path, property) {
    var data = _.get(result, path, []);

    if(data && _.isArray(data)) {
      return data.length ? data.map(function(item) {
        return item[property];
      }).join('\n') : undefined;
    }

    return data ? data[property] : undefined;
  }

  function getExtraction(item, config, confidence) {
    /* jscs:disable requireCamelCaseOrUpperCaseIdentifiers */
    var count = item.doc_count;
    /* jscs:enable requireCamelCaseOrUpperCaseIdentifiers */
    var extraction = {
      confidence: confidence,
      count: count,
      id: commonTransforms.getExtractionDataId(item.key, item.value, config.type),
      icon: config.icon,
      link: commonTransforms.getLink(item.key, config.link, config.key),
      styleClass: commonTransforms.getStyleClass(config.color),
      text: commonTransforms.getExtractionDataText(item.key, item.value, config.type),
      type: config.key
    };
    if(config.type !== 'url') {
      extraction.classifications = {
        database: '',
        type: config.key,
        user: ''
      };
    }
    if(config.type === 'location') {
      var locationData = commonTransforms.getLocationDataFromKey(item.key);
      extraction.latitude = locationData.latitude;
      extraction.longitude = locationData.longitude;
      extraction.text = locationData.text;
      extraction.textAndCount = locationData.text + (extraction.count ? (' (' + extraction.count + ')') : '');
      extraction.textAndCountry = locationData.text + (locationData.country ? (', ' + locationData.country) : '');
    }
    if(config.type === 'image') {
      extraction.source = item.value;
    }
    return extraction;
  }

  function getExtractionsFromList(extractionList, config) {
    var extractionData = extractionList.map(function(item) {
      var confidence = _.isUndefined(item.confidence) ? undefined : (Math.round(Math.min(item.confidence, 1) * 10000.0) / 100.0);
      return getExtraction(item, config, confidence);
    });
    var filterFunction = commonTransforms.getExtractionFilterFunction(config.type);
    return (filterFunction ? extractionData.filter(filterFunction) : extractionData);
  }

  function getExtractionsFromResult(result, path, config) {
    var data = _.get(result, path, []);
    return getExtractionsFromList(data, config);
  }

  function getHighlightedText(result, paths) {
    var path = _.find(paths, function(path) {
      return result.highlight && result.highlight[path] && result.highlight[path].length && result.highlight[path][0];
    });
    return path ? result.highlight[path][0] : undefined;
  }

  function getHighlightPathList(item, result, highlightMapping) {
    /* jscs:disable requireCamelCaseOrUpperCaseIdentifiers */
    var pathList = result.matched_queries;
    /* jscs:enable requireCamelCaseOrUpperCaseIdentifiers */

    if(pathList && pathList.length && highlightMapping && highlightMapping[item.id]) {
      return pathList.filter(function(path) {
        return _.startsWith(path, highlightMapping[item.id]);
      }).map(function(path) {
        return path.split(':')[1];
      });
    }

    return [];
  }

  function cleanHighlight(text, type) {
    // Ignore partial matches for emails.
    if(type === 'email' && (!_.startsWith(text, '<em>') || !_.endsWith(text, '</em>'))) {
      return text.toLowerCase();
    }

    var output = text;

    // Usernames are formatted "<website> <username>".  Ignore matches on the <website>.
    if(type === 'username') {
      output = output.indexOf(' ') ? output.substring(output.indexOf(' ') + 1) : output;
    }

    return output.indexOf('<em>') >= 0 ? output.replace(/<\/?em\>/g, '').toLowerCase() : '';
  }

  function addHighlight(item, result, type, highlightMapping) {
    var pathList = getHighlightPathList(item, result, highlightMapping);
    if(result.highlight && pathList.length) {
      item.highlight = pathList.some(function(path) {
        return (result.highlight[path] || []).some(function(text) {
          var cleanedHighlight = cleanHighlight(text, type);
          return cleanedHighlight && (('' + item.id).toLowerCase().indexOf(cleanedHighlight) >= 0);
        });
      });
    }
    return item;
  }

  function addAllHighlights(data, result, type, highlightMapping) {
    return data.map(function(item) {
      return addHighlight(item, result, type, highlightMapping);
    });
  }

  function getHighlightedExtractionObjectFromResult(result, config, highlightMapping) {
    var data = getExtractionsFromResult(result, '_source.knowledge_graph.' + config.key, config);
    if(highlightMapping) {
      data = addAllHighlights(data, result, config.type, highlightMapping[config.key]);
    }
    return {
      data: data,
      name: config.titlePlural
    };
  }

  function getDocumentObject(result, searchFields, highlightMapping) {
    var id = _.get(result, '_source.doc_id');
    var url = _.get(result, '_source.url');

    if(!id || !url) {
      return {};
    }

    var rank = _.get(result, '_score');
    var domain = _.get(result, '_source.tld');

    var documentObject = {
      id: id,
      url: url,
      rank: rank ? rank.toFixed(2) : rank,
      domain: domain || 'No Domain',
      type: 'document',
      icon: 'icons:assignment',
      link: commonTransforms.getLink(id, 'entity', 'document'),
      styleClass: '',
      cached: commonTransforms.getLink(id, 'cached'),
      // TODO
      title: getSingleStringFromResult(result, '_source.content_extraction.title', 'text') || 'No Title',
      description: getSingleStringFromResult(result, '_source.content_extraction.content_strict', 'text') || 'No Description',
      highlightedText: getHighlightedText(result, ['content_extraction.title.text']),
      headerExtractions: [],
      detailExtractions: [],
      details: []
    };

    documentObject.headerExtractions = searchFields.filter(function(object) {
      return object.result === 'header';
    }).map(function(object) {
      return getHighlightedExtractionObjectFromResult(result, object, highlightMapping);
    });

    var domainExtraction = getExtraction({
      key: domain,
    }, {
      color: 'light green',
      key: 'website',
      icon: 'av:web',
      type: 'url'
    });

    documentObject.headerExtractions.splice(0, 0, {
      name: 'Website',
      data: [domainExtraction]
    });

    documentObject.detailExtractions = searchFields.filter(function(object) {
      return object.result === 'detail';
    }).map(function(object) {
      return getHighlightedExtractionObjectFromResult(result, object, highlightMapping);
    });

    documentObject.details.push({
      name: 'Url',
      link: url,
      text: url
    });

    documentObject.details.push({
      name: 'Description',
      highlightedText: getHighlightedText(result, ['content_extraction.content_strict.text']),
      text: documentObject.description
    });

    if(documentObject.cached) {
      documentObject.details.push({
        name: 'Cached Ad Webpage',
        link: documentObject.cached,
        text: 'Open'
      });
    }

    // TODO Images

    return documentObject;
  }

  return {
    document: function(data, searchFields) {
      if(data && data.hits && data.hits.hits && data.hits.hits.length) {
        return getDocumentObject(data.hits.hits[0], searchFields);
      }
      return {};
    },

    documents: function(data, searchFields) {
      if(data && data.hits && data.hits.hits && data.hits.hits.length) {
        return data.hits.hits.map(function(result) {
          // Data returned by the searchResults function from the searchTransforms will have a "fields" property.
          return getDocumentObject(result, searchFields, data.fields);
        });
      }
      return [];
    }
  };
});
