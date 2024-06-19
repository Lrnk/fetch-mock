import glob from 'glob-to-regexp';
import pathToRegexp from 'path-to-regexp';
import querystring from 'querystring';
import isSubset from 'is-subset';
import isEqual from 'lodash.isequal';
import {
	headers as headerUtils,
	getPath,
	getQuery,
	normalizeUrl,
} from './request-utils.js';

const stringMatchers = {
	begin: (targetString) =>
		(url) => url.indexOf(targetString) === 0,
	end: (targetString) =>
		
			(url) => url.substr(-targetString.length) === targetString,
		
	glob: (targetString) => {
		const urlRX = glob(targetString);
		return (url) => urlRX.test(url);
	},
	express: (targetString) => {
		const urlRX = pathToRegexp(targetString);
		return (url) => urlRX.test(getPath(url));
	},
	path: (targetString) =>
		(url) => getPath(url) === targetString,
};

const getHeaderMatcher = ({ headers: expectedHeaders }) => {
	if (!expectedHeaders) {
		return;
	}
	const expectation = headerUtils.toLowerCase(expectedHeaders);
	return (url, { headers = {} }) => {
		const lowerCaseHeaders = headerUtils.toLowerCase(
			headerUtils.normalize(headers),
		);
		return Object.keys(expectation).every((headerName) =>
			headerUtils.equal(lowerCaseHeaders[headerName], expectation[headerName]),
		);
	};
};

const getMethodMatcher = ({ method: expectedMethod }) => {
	if (!expectedMethod) {
		return;
	}
	return (url, { method }) => {
		const actualMethod = method ? method.toLowerCase() : 'get';
		return expectedMethod === actualMethod;
	};
};

const getQueryStringMatcher = ({ query: passedQuery }) => {
	if (!passedQuery) {
		return;
	}
	const expectedQuery = querystring.parse(querystring.stringify(passedQuery));
	const keys = Object.keys(expectedQuery);
	return (url) => {
		const query = querystring.parse(getQuery(url));
		return keys.every((key) => {
			if (Array.isArray(query[key])) {
				if (!Array.isArray(expectedQuery[key])) {
					return false;
				}
				return isEqual(query[key].sort(), expectedQuery[key].sort());
			}
			return query[key] === expectedQuery[key];
		});
	};
};

const getParamsMatcher = ({ params: expectedParams, url: matcherUrl }) => {
	if (!expectedParams) {
		return;
	}
	if (!/express:/.test(matcherUrl)) {
		throw new Error(
			'fetch-mock: matching on params is only possible when using an express: matcher',
		);
	}
	const expectedKeys = Object.keys(expectedParams);
	const keys = [];
	const re = pathToRegexp(matcherUrl.replace(/^express:/, ''), keys);
	return (url) => {
		const vals = re.exec(getPath(url)) || [];
		vals.shift();
		const params = keys.reduce(
			(map, { name }, i) =>
				vals[i] ? Object.assign(map, { [name]: vals[i] }) : map,
			{},
		);
		return expectedKeys.every((key) => params[key] === expectedParams[key]);
	};
};

const getBodyMatcher = (route) => {
	const { body: expectedBody } = route;

	return (url, { body, method = 'get' }) => {
		if (method.toLowerCase() === 'get') {
			// GET requests don’t send a body so the body matcher should be ignored for them
			return true;
		}

		let sentBody;

		try {
			sentBody = JSON.parse(body);
		} catch (err) {
		}

		return (
			sentBody &&
			(route.matchPartialBody
				? isSubset(sentBody, expectedBody)
				: isEqual(sentBody, expectedBody))
		);
	};
};

const getFullUrlMatcher = (route, matcherUrl, query) => {
	// if none of the special syntaxes apply, it's just a simple string match
	// but we have to be careful to normalize the url we check and the name
	// of the route to allow for e.g. http://it.at.there being indistinguishable
	// from http://it.at.there/ once we start generating Request/Url objects
	const expectedUrl = normalizeUrl(matcherUrl);
	if (route.identifier === matcherUrl) {
		route.identifier = expectedUrl;
	}

	return (matcherUrl) => {
		if (query && expectedUrl.indexOf('?')) {
			return matcherUrl.indexOf(expectedUrl) === 0;
		}
		return normalizeUrl(matcherUrl) === expectedUrl;
	};
};

const getFunctionMatcher = ({ functionMatcher }) => {
	return (...args) => {
		return functionMatcher(...args);
	};
};

const getUrlMatcher = (route) => {
	const { url: matcherUrl, query } = route;

	if (matcherUrl === '*') {
		return () => true;
	}

	if (matcherUrl instanceof RegExp) {
		return (url) => matcherUrl.test(url);
	}

	if (matcherUrl.href) {
		return getFullUrlMatcher(route, matcherUrl.href, query);
	}

	for (const shorthand in stringMatchers) {
		if (matcherUrl.indexOf(`${shorthand}:`) === 0) {
			const urlFragment = matcherUrl.replace(new RegExp(`^${shorthand}:`), '');
			return stringMatchers[shorthand](urlFragment);
		}
	}

	return getFullUrlMatcher(route, matcherUrl, query);
};

export default [
	{ name: 'query', matcher: getQueryStringMatcher },
	{ name: 'method', matcher: getMethodMatcher },
	{ name: 'headers', matcher: getHeaderMatcher },
	{ name: 'params', matcher: getParamsMatcher },
	{ name: 'body', matcher: getBodyMatcher, usesBody: true },
	{ name: 'functionMatcher', matcher: getFunctionMatcher },
	{ name: 'url', matcher: getUrlMatcher },
];
