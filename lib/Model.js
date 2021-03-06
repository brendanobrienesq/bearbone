// ** Abstract Class Does not export a Model object**
var db = require('ninjazord')
	, Err = require('./Err')
	, utils = require('./Utils')
	, EventEmitter = require('events').EventEmitter;

var Model = function (options) {
	var self = this
		, name = this.name;

	if (!self.name) throw 'name required for model'; 
	EventEmitter.call(this);

	this.attributes.id 			|| (this.attributes.id = { type : 'number' })
	this.attributes.created || (this.attributes.created = { type : 'number' })
	this.attributes.updated || (this.attributes.updated = { type : 'number'})
	this.attributes._type   || (this.attributes._type = { type : 'string'})

	if (self.protocols.length) {
		self.protocols.forEach(function(Protocol) {
			new Protocol(self);
		});
	}

	if (this.externalId === true) {
		this.attributes.required = this.externalId;
		this.create = this._externalIdCreate;
	}
 
	self.initialize(options);
	self.setRequiredAttributes();
}

utils.extend( Model.prototype, {
	// Inherit The model from EventEmitter
	__proto__ : EventEmitter.prototype,
	// All Models must define a name.
	name : undefined,
	// Give all subsequent models access to database tools
	db : db,
	// Export error for easy error creation
	Error : Err.Model,
	// This dictates what attributes get stored on the model
	// attribute : [ typeof , (requiredForCreation), (private), (defaultVal) ]
	// defaults : [ 'string', false, false, undefined ]
	attributes : {
		id 			: { type : 'number' },
		created : { type : 'number' },
		updated : { type : 'number' },
		_type   : { type : 'string' }
	},
	// An array of any Protocols you'd like this model to conform to.
	// Will be called on construction, see Protocols file.
	protocols : [],

	// set this to true if you want to set the ID yourself on creation.
	externalId : false,

	// callback utility to only call back if the function exists.
	cb : function (err, res, callback) {
		return (typeof callback === 'function') ? callback(err, res) : false;
	},
	// return the id property, given a model object.
	id : function (model) {
		if (typeof model === "object") { return model.id }
		else { return model; }
	},
	nameSpace : function (id) { return this.name + '.' + id; },
	setRequiredAttributes : function () {
		var self = this, requiredAttributes = [];
		for (var attr in self.attributes) {
			if (self.attributes[attr].required) requiredAttributes.push(attr);
		}
		self.requiredAttributes = requiredAttributes;
	},

	// copy over attributes to new object for working with
	attrsObject : function (obj, options) {
		var result = {};
		for (var key in this.attributes) {
			if (obj[key]) { result[key] = obj[key]; }
		}
		return result;
	},
	/* Validate should return either a model error, or true*/
	validate: function(attrs, options) {
		var self = this, valid = true, attrType;
		options || (options = {})
		if (!attrs || typeof attrs != 'object') return new Err.Model("No Attributes Provided");
		if (options.update && !attrs.id) return new Err.Model("No id Provided for update");

		for (var attr in attrs) {
			if (!self.attributes[attr]) { delete attrs[attr]; continue; }

			attrType = self.attributes[attr].type;
			// if it's a model name, make sure the _type property matches, and
			// conform the id.
			if (self._modelType(attrType)) {

				// for now, if just a number is provided, assume it's the id & move on.
				// also, if attr isn't an object, we can't work with it, so move on.
				if (typeof attrs[attr] === "number" || typeof attrs[attr] !== "object") { continue; }

				if (!attrs[attr]._type) { delete attrs[attr]; continue; } 
				if (attrType != attrs[attr]._type && attrType !== "model") { delete attrs[attr]; continue; }
				attrs[attr] = attrs[attr].id;
			}
			// or else it's a primative type
			else if (typeof attrs[attr] != attrType) {
				// the attribute doesn't match it's type. try to reslove it.
				if (attrType === 'boolean') {
					if (attrs[attr] === 'true') attrs[attr] = true;
					if (attrs[attr] === 'false') attrs[attr] = false;
				} else if (attrType === 'number') {
					attrs[attr] = +attrs[attr];
					if ( isNaN(attrs[attr]) || !attrs[attr] ) delete attrs[attr];
				}

				// if it still doesn't match, delete it.
				if (typeof attrs[attr] !== attrType) delete attrs[attr];
			}
		}

		if (!options.update){
			// Add default if no value is supplied.
			for (attr in self.attributes) {
				if ( (self.attributes[attr].default !== undefined) && attrs[attr] === undefined)
					attrs[attr] = self.attributes[attr].default;
			}

			// check required attrs
			self.requiredAttributes.forEach(function(attr){
				if (attrs[attr] === undefined) {
					valid = new Err.Model(attr + " attribute missing");
					if (self.verbose) console.error('%s attr missing',attr);
				}
			});
		}

		return valid;
	},
	exists : function (id, callback) { var self = this; self.db.objectExists(self.name,id,callback); },
	parse : function (attrs,options) {
		return attrs;
	},
	create : function (obj, options, callback) {
		if (arguments.length === 2) { callback = options; options = {}; }
		options || (options = {});

		var self = this
			, attrs = self.attrsObject(obj)
			, valid = this.validate(this.parse(attrs,options),options)

		
		if (valid instanceof Error){ return self.cb(valid, null, callback); }
		if (valid != true) { return self.cb(new Error("invalid attributes for creating " + self.name + " object."), undefined, callback);}
		self.preCreate(attrs, options, function(err){
			if (err) { return self.cb(err, null, callback); }
			self.db.createObject(self.name, attrs, function(err, object){
				if (err) { return self.cb(err,null,callback); }
				options.isNew = true;
				object._type = self.name;
				self.postCreate(object, options, function(err){
					self.postRead(object, options, function(err){
						self.emit('created', self.private(object), options);
						self.cb(null, self.public(object), callback);
					});
				});
			});
		});
		return true;
	},
	_externalIdCreate : function (attrs, options, callback) {
		if (arguments.length === 2) { callback = options; options = {}; }
		options || (options = {});

		var self = this
			, valid = this.validate(this.parse(attrs,options),options);
		
		if (valid instanceof Error){ return self.cb(valid, null, callback); }
		if (valid != true) { return self.cb(new Error("invalid attributes for creating " + self.name + " object."), undefined, callback);}
		self.preCreate(attrs, options, function(err){
			if (err) { return self.cb(err, null, callback); }
			self.db.createObjectWithExternalId(self.name, attrs.id, attrs, function(err, object){
				if (err) { return self.cb(err,null,callback); }
				options.isNew = true;
				object._type = self.name;
				self.postCreate(object, options, function(err){
					self.postRead(object, options, function(err){
						self.emit('created', self.private(object), options);
						self.cb(null, self.public(object), callback);
					});
				});
			});
		});
		return true;
	},
	// called just before creation
	preCreate : function (attrs, options, done) {
		done();
	},
	// called just after creation
	postCreate : function (model, options, done) {
		done();
	},
	read : function (ids, options, callback) {
    var self = this, method;

    if (arguments.length === 2) { callback = options; options = {}; }
    options || (options = {});
    // unless private : true is specified, we read with
    // the public method
    method = (options.private) ? 'private' : 'public';

    // accept an array of model Ids
    if (ids instanceof Array && ids.length) {
      var objects = [], count = ids.length;
      options.set = true;

      ids.forEach(function(id){
        self._read(id, options, function(err, object){
          if (err) { if (--count === 0) { self.cb(err, undefined, callback); } return; }
          // if the object returns false, we don't want to add it.
          if (typeof object === 'object') objects.push( self[method](object) );
          if (--count === 0) self.cb(null, objects, callback);
        });
      });

    // or just a single id.
    } else {
      self._read(ids, options, function(err, object){
        if (err) { return self.cb(err, undefined, callback); }
        self.cb(err, self[method](object), callback);
      });
    }

    return this;
	},
	_read : function (id, options, callback) {
		var self = this;

		if (arguments.length === 2) { callback = options; options = {}; }
		options || (options = {});

		self.db.readObject(self.name, id, function(err,object){
			if (err) { return self.cb(err,null,callback); }
			self.parseNumericalAttributes(object);
			object._type = self.name;
			self.postRead(object, options, function(err){
				object = options.private ? self.private(object) : self.public(object);
				self.cb(err, object, callback);
			});
		});
	},
	// called after a single model is read for specific option overriding
	// get references in here, whatever you need to do to flesh out the model
	// modify the model, then invoke done when you're finished (only once!)
	postRead : function (model,options,done) {
		done();
	},
	update : function (attrs, options, callback) {
		var self = this
			, valid;

		if (typeof options === 'function') { callback = options; options = {}; }
		options || (options = {});

		valid = self.validate(this.parse(attrs,options), { update : true });
		if (valid instanceof Err.Model){ return self.cb(valid, false, callback); }
		if (valid != true){ return self.cb(new Err.Model('invalid update attrs'), false, callback); }

		self._read(attrs.id, function(err, oldObject){
			if (err) { return self.cb(err,null,callback); }
			self.preUpdate(attrs, oldObject, options, function (err){
				if (err) { return self.cb(err, null, callback); }
				self.db.updateObject(self.name, attrs.id, attrs, function(err, res){
					if (err) { return self.cb(err,null,callback); }
					self._read(attrs.id,function(err, object){
						if (err) { return self.cb(err,false,callback); }
						if (!options.silent)
							self.emit('updated', self.private(object), self.private(oldObject), options);
						self.cb(null, self.public(object),callback);
					});
				});
			});
		});
		return true;
	},
	preUpdate : function (attrs, oldObject, options, done) {
		done();
	},
	del : function (id, options, callback) {
		var self = this;
    
    if (typeof options === "function") { callback = options; options = undefined; }
    options || (options = {})
    if (typeof id === "object") { id = object.id; }

		self.read(id, function(err, object){
			if (self.verbose) { console.log('deleting: ' + self.name + "." + id); }
			self.db.deleteObject(self.name, id, function(err,res){
				self.emit('deleted', self.private(object));
				self.cb(err,object,callback);
			});
		});

		return this;
	},
	count : function (callback) {
		var self = this;
		this.db.get(this.name + '.new', function(err,count){
			if (err) { return self.cb(err,null,callback); }

			if (count) count = parseInt(count, 10);
			self.cb(err,count,callback);
		});
	},
	// Public should be called to package model data for public
	// use. Models passed around by events can carry sensitive stuff
	// and then use format to output
	// * must return the object *
	public : function (attrs) { return attrs; },
	// private does the same thing as public, but for events emitted
	// by the model. useful for adding / setting attributes after
	// create / update / delete
	// * must return the object *
	private : function (attrs) { return attrs; },
	// Use Initialize to set up any model stuff that should be called
	initialize : function (options) {},
	size : function (obj) {
		var size = 0, key;
		for (key in obj)
			if (obj.hasOwnProperty(key)) size++;
		return size;
	},
	// make sure any attrs delivered as strings are numbers
	parseNumericalAttributes : function (object) {
		for (var attr in object) {
			if (!this.attributes[attr]) { 
				if (this.verbose) console.error('unrecognized stored attribute: ' + this.name + '.' + object.id + " : " + attr);
				delete object.attr;
				continue;
			}
			if (this.attributes[attr].type === 'number') object[attr] = parseFloat(object[attr],10);
		}
	},
	// determine if the attribute type is the name of a model
	_modelType : function (type) {
		return (type != "string" && type != "number" && type != "object" && type != "boolean" && type != "function");
	},
	// inherit utils bind method.
	bind : utils.bind
});

// Model Extend Method.
Model.extend = utils.classExtend;


module.exports = Model;