'use strict';

/* Services */
angular.module('arachne.services', [])

	// singleton service for search access
	// automatically parses the query parameters in the current location
	// and caches query results
	.factory('searchService', ['$location', 'Entity', '$rootScope', 'Query', '$q',
		function($location, Entity, $rootScope, Query, $q) {

			var _currentQuery = Query.fromSearch($location.search());
			var _result = { entities: [] };
			var CHUNK_SIZE = 50;
			var chunkPromise = false;

			// check if query changed in a way that requires a new backend call
			$rootScope.$on("$locationChangeSuccess", function(event, newState, oldState) {
				if (Object.keys($location.search()).length > 0) {
					var newQuery = Query.fromSearch($location.search());
					if (!angular.equals(newQuery.toFlatObject(),_currentQuery.toFlatObject())) {
						_result = { entities: [] };
					}
					_currentQuery = newQuery;
				}
			});

			// wait for other retrieve operations to be finished
			// and retrieve a chunk from the current search result
			function retrieveChunkDeferred(offset) {
				if (chunkPromise) {
					chunkPromise = chunkPromise.then(function(data) {
						return retrieveChunk(offset);
					});
				} else {
					chunkPromise = retrieveChunk(offset);
				}
				return chunkPromise;
			}

			// retrieve a chunk from the current search result
			// checks if the requested chunk is cached, otherwise
			// a new query is sent to the backend
			function retrieveChunk(offset) {

				var deferred = $q.defer();

				// chunk is cached
				if (!angular.isUndefined(_result.entities[offset])) {
					var entities = _result.entities.slice(offset, offset + CHUNK_SIZE);
					chunkPromise = false;
					deferred.resolve(entities);
					return deferred.promise;
				// chunk needs to be retrieved
				} else {
					var query = angular.extend({offset:offset,limit:CHUNK_SIZE},_currentQuery.toFlatObject());
					var entities = Entity.query(query);
					return entities.$promise.then(function(data) {
						_result.size = data.size;
						_result.facets = data.facets;
						if (data.size == 0) { 
							deferred.resolve([]);
						} else {
							if(data.entities) for (var i = 0; i < data.entities.length; i++) {
								_result.entities[parseInt(offset)+i] = data.entities[i];
							}
						}
						chunkPromise = false;
						deferred.resolve(data.entities);
						return deferred.promise;
					}, function(response) {
						chunkPromise = false;
						deferred.reject(response);
						return deferred.promise;
					});
				}

			}

			return {

				// get a single entity from the current result
				getEntity: function(resultIndex) {

					var deferred = $q.defer();

					if (resultIndex < 1) {
						deferred.reject();
						return deferred.promise;
					}
					
					// resultIndex starts at 1, offset and data[] start at 0
					var offset = Math.floor((resultIndex-1) / CHUNK_SIZE) * CHUNK_SIZE;
					
					return retrieveChunkDeferred(offset).then(function(data) {
						deferred.resolve(data[resultIndex-1 - offset]);
						return deferred.promise;
					});

				},

				// get current facets
				getFacets: function() {
					return _result.facets;
				},

				// get current results size
				getSize: function() {
					return _result.size;
				},

				// get current page as defined by the query's offset
				getCurrentPage: function() {
					var offset = _currentQuery.offset;
					if (angular.isUndefined(offset)) offset = 0;
					return retrieveChunkDeferred(offset);
				},

				// get current query
				currentQuery: function() {
					return _currentQuery;
				}

			}

		}
	])

	// represents a search query
	// handles conversion between string representation for frontend URLs
	// and flat object representation for backend requests
	.factory('Query', function() {

		function Query() {
			this.facets = [];
			this.offset = 0;
			this.limit = 50;
		}

		Query.prototype = {

			// constructs a new query object from this query
			// and adds or replaces a parameter, returns the new query
			setParam: function(key,value) {
				var newQuery = angular.copy(this);
				newQuery[key] = value;
				return newQuery;
			},

			// constructs a new query object from this query
			// and removes a parameter, returns the new query
			removeParam: function(key) {
				var newQuery = angular.copy(this);
				delete newQuery[key];
				return newQuery;
			},

			// constructs a new query object from this query
			// and removes parameters, returns the new query
			removeParams: function(keys) {
				var newQuery = angular.copy(this);
				for (var i = 0; i < keys.length; i++) {
					delete newQuery[keys[i]];
				}
				return newQuery;
			},

			// return a copy of param, always return an array, even
			// if it has one or zero elements
			getArrayParam: function(key) {
				var value = this[key];

				if (angular.isArray(value)) {
					return angular.copy(value);
				} else if (value !== undefined) {
					return [angular.copy(value)];
				} else {
					return [];
				}
			},

			// constructs a new query object from this query
			// and adds an additional facet, returns the new query
			addFacet: function(facetName,facetValue) {
				var newQuery = angular.copy(this);
				newQuery.facets.push({key:facetName, value:facetValue});
				return newQuery;
			},

			// constructs a new query object from this query
			// and removes a facet, returns the new query
			removeFacet: function(facetName) {
				var newQuery = angular.copy(this);
				newQuery.facets = newQuery.facets.filter(function(facet) {
				    return facet.key !== facetName;
				});
				return newQuery;
			},

			// check if query has any particular facet filter attached
			hasFacet: function(facetName) {
				return this.facets.some(function(facet) {
					return (facet.key == facetName);
				});
			},

			// check if query has any facet filters attached
			hasFacets: function() {
				return this.facets.length > 0;
			},

			// returns a representation of this query as GET parameters
			// If a paramter is given as an array, mutiple GET-Paramters with
			// the same name are constructed (conforming to $location)
			toString: function() {
				
				var params = [];
				for(var key in this) {
					if (key == 'facets') {
						for(var i in this.facets) {
							var facetString = this.facets[i].key + ":\"" + this.facets[i].value + "\"";
							params.push("fq=" + encodeURIComponent(facetString));
						}
					} else if (angular.isString(this[key]) || angular.isNumber(this[key])) {
						if(!(key == 'limit') && (this[key] || key == 'resultIndex')) {
							params.push(key + "=" + encodeURIComponent(this[key]));
						}
					} else if (angular.isArray(this[key])) {
						for (var i = 0; i < this[key].length; i++) {
							params.push(key + "=" + encodeURIComponent(this[key][i]));
						}
					}
				}

				if (params.length > 0) {
					return "?" + params.join("&");
				} else {
					return "";
				}
				
			},

			// return a representation of this query as a flat object
			// that can be passed as a params object to $resource and $http
			toFlatObject: function() {
				var object = {};
				var queries = [];
				for(var key in this) {
					if (key == 'facets') {
						object.fq = [];
						for(var i in this.facets) {
							var facetString = this.facets[i].key + ":\"" + this.facets[i].value + "\"";
							object.fq.push(facetString);
						}
					} else if (key == 'restrict') {
						queries.push("_exists_:" + this[key]);
					} else if (key == 'catalogIds') {
						queries.push("catalogIds:" + this[key]);
					} else if (key == 'q') {
						queries.push(this[key] + " -facet_kategorie:Orte");
					} else if (['fl','limit','sort','desc'].indexOf(key) != -1) {
						object[key] = this[key];
					}
				}
				object.q = queries.join(' AND ');
				return object;
			}

		};

		// factory for building query from angular search object
		Query.fromSearch = function(search) {
			var newQuery = new Query();
			for(var key in search) {
				if (key == 'fq') {
					if (angular.isString(search['fq'])) {
						var facet = search['fq'].split(':');
						if (facet.length == 2)
							newQuery.facets.push({key:facet[0], value: facet[1].substr(1,facet[1].length-2)});
					} else if (angular.isArray(search['fq'])) {
						search['fq'].forEach(function(facetString) {
							var facet = facetString.split(':');
							newQuery.facets.push({key:facet[0], value: facet[1].substr(1,facet[1].length-2)});
						})
					}
				} else {
					newQuery[key] = search[key];
				}
			}
			return newQuery;
		}

		return Query;

	})

	// resource interface for backend requests to entity- and search-endpoints
	.factory('Entity', ['$resource', 'arachneSettings', '$q',
		function($resource, arachneSettings, $q) {

			return $resource(
				arachneSettings.dataserviceUri + "/:endpoint/:id",
				{ id: '@entityId' },
				{
					get: { 
						method: 'GET', 
						params: { endpoint: 'entity'} 
					},
					query: { 
						method: 'GET', 
						params: { endpoint: 'search' } 
					},
					contexts: { 
						method: 'GET',
						params: { endpoint: 'contexts'} 
					},
					specialNavigations: {
						method: 'GET',
						url: arachneSettings.dataserviceUri + '/specialNavigationsService'
					},
					imageProperties: {
						method: 'GET',
						url: arachneSettings.dataserviceUri + '/image/zoomify/:id/ImageProperties.xml',
						cache: false,
						interceptor: {
							response: function(response) {
								var data = response.data;
								if(data) {
									var properties = {};
									if (window.DOMParser) {
										var parser = new DOMParser();
										properties = parser.parseFromString(data,"text/xml");
									} else {
										properties = new ActiveXObject("Microsoft.XMLDOM");
										properties.async=false;
										properties.loadXML(data);
									}
									if(properties.firstChild)
									return {
										width : properties.firstChild.getAttribute('WIDTH'),
										height : properties.firstChild.getAttribute('HEIGHT'),
										tilesize : properties.firstChild.getAttribute('TILESIZE')
									};
								}
							}
						}
					}
				}
			);

		}
	])

	// singleton service for authentication, stores credentials in browser cookie
	// if cookie is present the stored credentials get sent with every backend request
	.factory('authService', ['$http', 'arachneSettings', '$filter', '$cookieStore', 
		function($http, arachneSettings, $filter, $cookieStore) {

			// initialize to whatever is in the cookie, if anything
			if ($cookieStore.get('ar-authdata')) {
		    	$http.defaults.headers.common['Authorization'] = 'Basic ' + $cookieStore.get('ar-authdata');
		    } else {
		    	delete $http.defaults.headers.common['Authorization'];
		    }
		 
		    return {

		        setCredentials: function (username, password, successMethod, errorMethod) {
		            var encoded = $filter('base64')(username + ':' + $filter('md5')(password));
		            $http.get(arachneSettings.dataserviceUri + '/', { headers: { 'Authorization': 'Basic ' + encoded } })
		            .success(function(response) {
		            	$http.defaults.headers.common.Authorization = 'Basic ' + encoded;
		            	$cookieStore.put('ar-authdata', encoded);
		            	$cookieStore.put('ar-user', { username: username });
		            	successMethod();
		            }).error(function(response) {
		            	errorMethod(response);
		            });
		        },

		        clearCredentials: function () {
		            document.execCommand("ClearAuthenticationCache");
		            $cookieStore.remove('ar-authdata');
		            $cookieStore.remove('ar-user');
		            delete $http.defaults.headers.common['Authorization'];
		        },

		        getUser: function() {
		        	return $cookieStore.get('ar-user');
		        }

		    };

		}
	])
	.factory('newsFactory', ['$http', 'arachneSettings', '$timeout', function($http, arachneSettings){
		var factory = {};
		factory.getNews = function() {
				return $http.get( arachneSettings.dataserviceUri + '/news/de');
			};
		return factory;
	}])

	.factory('categoryService', ['$http', function($http ){

		var categories = null;

		var promise = $http.get('config/category.json').then(function(response) {
			categories = response.data;
			return categories;
		});

		var factory = {};

		factory.getCategoriesAsync = function() {
			return promise;
		};

		factory.getCategories = function() {
			return categories;
		};

		factory.getSingular = function(category) {
			if (category in categories && "singular" in categories[category]) {
				return categories[category].singular;
			} else {
				return category;
			}
		}

		return factory;

	}])

	.factory('con10tService', function($http) { 
		var factory = {};
		factory.getTop = function() {
    		return $http.get('con10t/top.json');
		}
		factory.getProjects = function() {
    		return $http.get('con10t/projects.json');
		}
		factory.getFront = function() {
    		return $http.get('con10t/front.json');
		}
		return factory;
	})

	.factory('contactService', ['$http', 'arachneSettings', '$resource',  function($http, arachneSettings, $resource) { 
		var contactService = $resource('', {}, {
			sendContact : {
				url: arachneSettings.dataserviceUri + '/contact',
				isArray: false,
				method: 'POST',
				headers: {'Content-Type': 'application/json'}
			}
		});
		return {
			sendContact : function(contact, successMethod, errorMethod){
				return contactService.sendContact(contact, successMethod, errorMethod);
			}
		}
	}])

	.factory('resetService', ['$http', 'arachneSettings', '$resource',  function($http, arachneSettings, $resource) { 
		var resetService = $resource('', {}, {
			resetpwd : {
				url: arachneSettings.dataserviceUri + '/user/reset',
				isArray: false,
				method: 'POST',
				headers: {'Content-Type': 'application/json'}
			}
		});
		return {
			resetpwd : function(pwd, successMethod, errorMethod){
				return resetService.resetpwd(pwd, successMethod, errorMethod);
			}
		}
	}])
	
	.factory('messageService', ['$http', '$rootScope', function($http, $rootScope) {

		var messageTypes;
		$http.get('config/messageTypes.json').success(function(response) {
			messageTypes = response;
		});
		var messages = {};

		// check age and close old messages when location changes
		$rootScope.$on("$locationChangeSuccess", function(event, newState, oldState) {
			angular.forEach(messages, function(msg, key) {
				messages[key].age++;
				if (msg.age >= 1) delete messages[key];
			});
		});

		return {

			addMessage: function(id, heading, body, level) {
				var message = {
					heading: heading,
					body: body,
					level: level,
					age: 0
				};
				messages[id] = message;
			},

			addMessageForCode: function(code) {
				if (code in messageTypes) {
					messages[code] = messageTypes[code];
					messages[code].age = 0;
				} else {
					messages['default'] = messageTypes['default'];
					messages['default'].age = 0;
				}
			},

			removeMessage: function(code) {
				delete messages[code];
			},

			getMessages: function() {
				return messages;
			}

		}

	}])

	.factory('Catalog', ['$resource', 'arachneSettings', function($resource, arachneSettings) {

		return $resource(arachneSettings.dataserviceUri + '/catalog/:id', null, {
        	'update': { method:'PUT' }
    	});

	}])

	.factory('CatalogEntry', ['$resource', 'arachneSettings', function($resource, arachneSettings) {

		return $resource(arachneSettings.dataserviceUri + '/catalogentry/:id');

	}])

	// Represents a maps configuration
	.factory('MapConfig', function() {

		function MapConfig() {

			this.menuTitle                     = null;
			this.menuHeadingOverlays           = "Overlays";
			this.menuHeadingMapfacetSelection  = "Typ der Ortsangabe";
			this.menuHeadingSearch             = "Aktuelle Suche";
			this.menuHeadingFilters            = "Filter";

			this.menuShowOverlays              = true;
			this.menuShowMapfacetSelection     = true;
			this.menuShowSearch                = true;
			this.menuShowFilters               = true;

			this.menuFacetsAllow               = null;
			this.menuFacetsDeny                = null;

			this.menuFacetsAppend              = null;

			this.facetsSelect                  = null;
		}

		MapConfig.prototype = {

			merge: function(other) {
				for (var key in other) {
					this[key] = other[key];
				}

				return this;
			}
		}

		return MapConfig;

	})

;
