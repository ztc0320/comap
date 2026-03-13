const markerComments = {};
const markerMap = {};

let currentMarker = null;
let currentMarkerLatLng = null;
let tempLatLngForMarker = null;

let searchMarkers = [];
let searchResults = [];
let selectedMarkerId = null;

const mapContainer = document.getElementById('map');
const mapOption = {
	center: new kakao.maps.LatLng(37.5665, 126.9780),
	level: 3
};

const map = new kakao.maps.Map(mapContainer, mapOption);
const ps = new kakao.maps.services.Places();
const geocoder = new kakao.maps.services.Geocoder();

/* =========================
공통 유틸
========================= */

function escapeHtml(text) {
	return $('<div>').text(text || '').html();
}

function makeCoordLocationKey(latlng) {
	if (!latlng) return '';

	const lat = Number(latlng.getLat()).toFixed(6);
	const lng = Number(latlng.getLng()).toFixed(6);

	return `coord:${lat}_${lng}`;
}

function makeBuildingLocationKey(addressName) {
	if (!addressName) return '';
	return `building:${addressName.trim()}`;
}

function extractAddressFromMarkerId(markerId) {
	if (!markerId || typeof markerId !== 'string') return '';
	if (!markerId.startsWith('building:')) return '';

	return markerId.replace(/^building:/, '').trim();
}

function formatDate(dateString) {
	const date = new Date(dateString);

	if (Number.isNaN(date.getTime())) return '';

	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');

	return `${year}.${month}.${day} ${hours}:${minutes}`;
}

function getMarkerTitle(markerId) {
	const marker = markerMap[markerId];
	const storedMarkerTitles = window.storedMarkerTitles = window.storedMarkerTitles || {};

	if (marker && marker.getTitle && marker.getTitle().trim() !== '') {
		return marker.getTitle();
	}

	if (storedMarkerTitles[markerId]) {
		return storedMarkerTitles[markerId];
	}

	return '';
}

function setMarkerTitle(markerId, title) {
	const storedMarkerTitles = window.storedMarkerTitles = window.storedMarkerTitles || {};
	storedMarkerTitles[markerId] = title;

	if (markerMap[markerId]) {
		markerMap[markerId].setTitle(title);
	}
}

function getPlaceDisplayTitle(place) {
	if (!place) return '';

	if (place.place_name && place.place_name.trim() !== '') {
		return place.place_name.trim();
	}

	if (place.road_address_name && place.road_address_name.trim() !== '') {
		return place.road_address_name.trim();
	}

	if (place.address_name && place.address_name.trim() !== '') {
		return place.address_name.trim();
	}

	return '';
}

function getAddressInfoFromCoord(latlng) {
	return new Promise(function(resolve) {
		if (!latlng) {
			resolve(null);
			return;
		}

		geocoder.coord2Address(
			latlng.getLng(),
			latlng.getLat(),
			function(result, status) {
				if (status !== kakao.maps.services.Status.OK || !result || !result.length) {
					resolve(null);
					return;
				}

				resolve(result[0]);
			}
		);
	});
}

function getLatLngFromAddress(addressName) {
	return new Promise(function(resolve) {
		if (!addressName) {
			resolve(null);
			return;
		}

		geocoder.addressSearch(addressName, function(result, status) {
			if (status !== kakao.maps.services.Status.OK || !result || !result.length) {
				resolve(null);
				return;
			}

			const first = result[0];
			const lat = Number(first.y);
			const lng = Number(first.x);

			if (Number.isNaN(lat) || Number.isNaN(lng)) {
				resolve(null);
				return;
			}

			resolve(new kakao.maps.LatLng(lat, lng));
		});
	});
}

async function getMarkerPositionByLocationKey(markerId, fallbackLatLng) {
	if (!markerId) {
		return fallbackLatLng || null;
	}

	if (markerId.startsWith('building:')) {
		const addressName = extractAddressFromMarkerId(markerId);
		const centerLatLng = await getLatLngFromAddress(addressName);

		if (centerLatLng) {
			return centerLatLng;
		}
	}

	return fallbackLatLng || null;
}

/*
	건물 우선 + 비건물은 좌표 fallback
	- place 검색 결과가 있고 road_address_name 이 있으면 building key
	- 일반 지도 클릭은 coord2Address 결과에 road_address 가 있으면 building key
	- road_address 가 없으면 coord key
*/
async function resolveLocationIdentity(latlng, place = null) {
	if (!latlng) {
		return {
			type: 'coord',
			key: '',
			title: ''
		};
	}

	if (place) {
		const roadAddress = place.road_address_name ? place.road_address_name.trim() : '';
		const title = getPlaceDisplayTitle(place);

		if (roadAddress) {
			return {
				type: 'building',
				key: makeBuildingLocationKey(roadAddress),
				title: title || roadAddress
			};
		}
	}

	const addressInfo = await getAddressInfoFromCoord(latlng);

	if (
		addressInfo &&
		addressInfo.road_address &&
		addressInfo.road_address.address_name
	) {
		const roadAddressName = addressInfo.road_address.address_name.trim();

		if (roadAddressName) {
			return {
				type: 'building',
				key: makeBuildingLocationKey(roadAddressName),
				title: roadAddressName
			};
		}
	}

	return {
		type: 'coord',
		key: makeCoordLocationKey(latlng),
		title: ''
	};
}

function readImageFile(file) {
	return new Promise(function(resolve, reject) {
		if (!file) {
			resolve('');
			return;
		}

		const reader = new FileReader();

		reader.onload = function(e) {
			resolve(e.target.result);
		};

		reader.onerror = function() {
			reject(new Error('파일을 읽을 수 없습니다.'));
		};

		reader.readAsDataURL(file);
	});
}

function bindFileName(inputSelector, textSelector) {
	$(inputSelector).on('change', function() {
		const file = this.files && this.files[0];
		$(textSelector).text(file ? file.name : '선택된 파일 없음');
	});
}

function resetFileName(inputSelector, textSelector) {
	$(inputSelector).val('');
	$(textSelector).text('선택된 파일 없음');
}

function resetCurrentMarker() {
	currentMarker = null;
	currentMarkerLatLng = null;
	tempLatLngForMarker = null;
}

function hideCommentBox() {
	$('#commentBox').hide();
	resetCurrentMarker();
}

function hideSidePanels() {
	$('#markerCommentsBox').removeClass('on').hide();
	$('#allCommentsBox').removeClass('on').hide();
	selectedMarkerId = null;
}

function setCurrentMarker(marker, latlng) {
	currentMarker = marker;
	currentMarkerLatLng = latlng;
}

function updateCommentBoxPosition(latlng) {
	const isMobile = window.innerWidth <= 768;
	const $commentBox = $('#commentBox');

	if (isMobile) {
		$commentBox.css({
			left: '0',
			right: '0',
			top: 'auto',
			bottom: '0'
		});
		return;
	}

	const latLngToUse = latlng || currentMarkerLatLng || tempLatLngForMarker;
	if (!latLngToUse) return;

	const projection = map.getProjection();
	if (!projection) return;

	const point = projection.containerPointFromCoords(latLngToUse);

	$commentBox.css({
		left: point.x + 20 + 'px',
		right: 'auto',
		top: point.y - 30 + 'px',
		bottom: 'auto'
	});
}

function normalizeCommentRow(row) {
	return {
		id: row.id,
		text: row.text || '',
		imageUrl: row.image_url || '',
		nickname: row.nickname || '',
		createdAt: row.created_at || new Date().toISOString(),
		userId: row.user_id || '',
		markerName: row.marker_name || '',
		markerId: row.marker_id || ''
	};
}

/* =========================
마커 관련
========================= */

function createMarker(latlng, options = {}) {
	const marker = new kakao.maps.Marker({
		position: latlng,
		map: map,
		title: options.title || ''
	});

	const markerId = options.markerId || makeCoordLocationKey(latlng);
	marker.__markerId = markerId;

	if (!markerComments[markerId]) {
		markerComments[markerId] = [];
	}

	markerMap[markerId] = marker;

	kakao.maps.event.addListener(marker, 'click', async function() {
		await showCommentBox(marker, marker.getPosition());
	});

	return marker;
}

function removeMarker(markerId) {
	if (!markerMap[markerId]) return;

	markerMap[markerId].setMap(null);
	delete markerMap[markerId];
	delete markerComments[markerId];

	const storedMarkerTitles = window.storedMarkerTitles = window.storedMarkerTitles || {};
	delete storedMarkerTitles[markerId];

	if (currentMarker && currentMarker.__markerId === markerId) {
		hideCommentBox();
	}

	if (selectedMarkerId === markerId) {
		selectedMarkerId = null;
		$('#markerCommentsBox').removeClass('on').hide();
	}

	if ($('#allCommentsBox').hasClass('on')) {
		renderAllComments();
	}
}

function clearSearchMarkers() {
	searchMarkers.forEach(function(marker) {
		if (marker) {
			marker.setMap(null);
		}
	});

	searchMarkers = [];
}

/* =========================
댓글 UI
========================= */

function showCommentBoxAt(latlng) {
	hideCommentBox();
	tempLatLngForMarker = latlng;
	$('#commentInput').val('');
	resetFileName('#commentImageInput', '#commentImageName');
	$('#commentsList').empty();
	$('#markerTitleBox').text('');
	$('#commentBox').show();
	updateCommentBoxPosition(latlng);
}

async function showCommentBox(marker, latlng) {
	setCurrentMarker(marker, latlng);

	const markerId = marker.__markerId;
	const comments = await loadCommentsByMarkerId(markerId);
	markerComments[markerId] = comments;

	const titleFromDb = comments.length && comments[0].markerName ? comments[0].markerName : '';
	if (titleFromDb && !getMarkerTitle(markerId)) {
		setMarkerTitle(markerId, titleFromDb);
	}

	$('#commentBox').hide();
	renderMarkerCommentsPanel(markerId);
}

function loadComments(markerId) {
	const comments = markerComments[markerId] || [];
	let html = '';

	$.each(comments, function(i, comment) {
		const commentText = typeof comment === 'string' ? comment : comment.text;
		const createdAt = typeof comment === 'string' ? '' : formatDate(comment.createdAt);
		const imageUrl = typeof comment === 'string' ? '' : (comment.imageUrl || '');
		const nickname = typeof comment === 'string' ? '' : (comment.nickname || '');

		html += `
			<li data-idx="${i}">
				<div class="comment-row">
					<div class="comment-content">
						<span class="comment-text">${escapeHtml(commentText)}</span>
						${imageUrl ? `<img src="${imageUrl}" alt="첨부 이미지" class="comment-image">` : ''}
						${nickname || createdAt ? `<span class="comment-meta">${escapeHtml(nickname)}${nickname && createdAt ? ' · ' : ''}${createdAt}</span>` : ''}
					</div>
					<button class="delete-comment-btn" data-marker="${markerId}" data-idx="${i}">삭제</button>
				</div>
			</li>
		`;
	});

	$('#commentsList').html(html);
}

async function addComment() {
	const user = await getCurrentUser();

	if (!user) {
		alert('로그인 후 이용해주세요.');
		return false;
	}

	const text = $('#commentInput').val().trim();
	const fileInput = $('#commentImageInput')[0];
	const file = fileInput ? fileInput.files[0] : null;

	if (!text && !file) {
		alert('댓글 또는 파일을 등록해주세요!');
		return false;
	}

	let imageUrl = '';

	if (file) {
		try {
			imageUrl = await readImageFile(file);
		} catch (error) {
			alert('이미지를 불러오지 못했습니다.');
			return false;
		}
	}

	if (!currentMarker && tempLatLngForMarker) {
		const locationInfo = await resolveLocationIdentity(tempLatLngForMarker);
		const markerId = locationInfo.key;

		if (!markerId) {
			alert('위치를 식별하지 못했습니다.');
			return false;
		}

		let marker = markerMap[markerId];

		if (!marker) {
			const markerLatLng = await getMarkerPositionByLocationKey(markerId, tempLatLngForMarker);

			marker = createMarker(markerLatLng || tempLatLngForMarker, {
				markerId: markerId,
				title: locationInfo.title || ''
			});
		} else if (locationInfo.title && !getMarkerTitle(markerId)) {
			setMarkerTitle(markerId, locationInfo.title);
		}

		const savedComment = await saveCommentToDb(
			markerId,
			text,
			imageUrl,
			marker.getPosition()
		);

		if (!savedComment) {
			if (!markerComments[markerId] || markerComments[markerId].length === 0) {
				removeMarker(markerId);
			}
			return false;
		}

		if (!markerComments[markerId]) {
			markerComments[markerId] = [];
		}

		markerComments[markerId].push(normalizeCommentRow(savedComment));

		setCurrentMarker(marker, marker.getPosition());
		tempLatLngForMarker = null;

		loadComments(markerId);
		$('#commentInput').val('');
		resetFileName('#commentImageInput', '#commentImageName');

		const markerTitle = getMarkerTitle(markerId);

		if (markerTitle && markerTitle.trim() !== '') {
			$('#markerTitleBox').html(escapeHtml(markerTitle));
		} else {
			$('#markerTitleBox').html('<span style="color:#aaa">마커 이름 없음</span>');
		}

		renderMarkerCommentsPanel(markerId);

		if ($('#allCommentsBox').hasClass('on')) {
			renderAllComments();
		}

		return true;
	}

	if (currentMarker && currentMarker.__markerId) {
		const markerId = currentMarker.__markerId;
		const savedComment = await saveCommentToDb(
			markerId,
			text,
			imageUrl,
			currentMarker.getPosition()
		);

		if (!savedComment) {
			return false;
		}

		if (!markerComments[markerId]) {
			markerComments[markerId] = [];
		}

		markerComments[markerId].push(normalizeCommentRow(savedComment));

		$('#commentInput').val('');
		resetFileName('#commentImageInput', '#commentImageName');
		loadComments(markerId);
		renderMarkerCommentsPanel(markerId);

		if ($('#allCommentsBox').hasClass('on')) {
			renderAllComments();
		}

		return true;
	}

	return false;
}

async function addCommentFromSidePanel() {
	const user = await getCurrentUser();

	if (!user) {
		alert('로그인 후 이용해주세요.');
		return false;
	}

	const text = $('#sideCommentInput').val().trim();
	const fileInput = $('#sideCommentImageInput')[0];
	const file = fileInput ? fileInput.files[0] : null;

	if (!text && !file) {
		alert('댓글 또는 파일을 등록해주세요!');
		return false;
	}

	if (!selectedMarkerId || !markerMap[selectedMarkerId]) {
		alert('선택된 마커가 없습니다.');
		return false;
	}

	let imageUrl = '';

	if (file) {
		try {
			imageUrl = await readImageFile(file);
		} catch (error) {
			alert('이미지를 불러오지 못했습니다.');
			return false;
		}
	}

	const marker = markerMap[selectedMarkerId];
	const savedComment = await saveCommentToDb(
		selectedMarkerId,
		text,
		imageUrl,
		marker ? marker.getPosition() : null
	);

	if (!savedComment) {
		return false;
	}

	if (!markerComments[selectedMarkerId]) {
		markerComments[selectedMarkerId] = [];
	}

	markerComments[selectedMarkerId].push(normalizeCommentRow(savedComment));

	$('#sideCommentInput').val('');
	resetFileName('#sideCommentImageInput', '#sideCommentImageName');

	if (currentMarker && currentMarker.__markerId === selectedMarkerId) {
		loadComments(selectedMarkerId);
	}

	renderMarkerCommentsPanel(selectedMarkerId);

	if ($('#allCommentsBox').hasClass('on')) {
		renderAllComments();
	}

	return true;
}

async function deleteComment(markerId, idx) {
	if (!markerComments[markerId] || markerComments[markerId][idx] === undefined) return;

	if (!confirm('정말로 이 댓글을 삭제하시겠습니까?')) return;

	const targetComment = markerComments[markerId][idx];

	if (!targetComment || !targetComment.id) {
		alert('댓글 정보를 찾을 수 없습니다.');
		return;
	}

	const success = await softDeleteCommentToDb(targetComment.id);

	if (!success) {
		return;
	}

	markerComments[markerId].splice(idx, 1);

	if (currentMarker && currentMarker.__markerId === markerId) {
		loadComments(markerId);
	}

	if (markerComments[markerId].length === 0) {
		removeMarker(markerId);
		$('#markerTitleBox').html('');
		return;
	}

	if (selectedMarkerId === markerId) {
		renderMarkerCommentsPanel(markerId);
	}

	if ($('#allCommentsBox').hasClass('on')) {
		renderAllComments();
	}
}

/* =========================
왼쪽: 선택 마커 댓글 패널
========================= */

function renderMarkerCommentsPanel(markerId) {
	const comments = markerComments[markerId] || [];
	const markerTitle = getMarkerTitle(markerId);

	selectedMarkerId = markerId;

	$('#markerCommentsBox').addClass('on').show();
	$('#markerCommentsPanelTitle').text('마커 댓글');
	$('#selectedMarkerNameInput').val(markerTitle || '');

	if (markerTitle) {
		$('#saveMarkerNameBtn').prop('disabled', true);
		$('#selectedMarkerNameInput').prop('disabled', true);
	} else {
		$('#saveMarkerNameBtn').prop('disabled', false);
		$('#selectedMarkerNameInput').prop('disabled', false);
	}

	let html = '';

	if (!comments.length) {
		html = '<li style="color:#888;">아직 등록된 댓글이 없습니다.</li>';
	} else {
		comments.forEach(function(comment, idx) {
			const commentText = typeof comment === 'string' ? comment : comment.text;
			const createdAt = typeof comment === 'string' ? '' : formatDate(comment.createdAt);
			const imageUrl = typeof comment === 'string' ? '' : (comment.imageUrl || '');
			const nickname = typeof comment === 'string' ? '' : (comment.nickname || '');

			html += `
				<li data-idx="${idx}">
					<div class="comment-row">
						<div class="comment-content">
							<span class="comment-text">${escapeHtml(commentText)}</span>
							${imageUrl ? `<img src="${imageUrl}" alt="첨부 이미지" class="comment-image">` : ''}
							${nickname || createdAt ? `<span class="comment-meta">${escapeHtml(nickname)}${nickname && createdAt ? ' · ' : ''}${createdAt}</span>` : ''}
						</div>
						<button class="delete-comment-btn" data-marker="${markerId}" data-idx="${idx}">삭제</button>
					</div>
				</li>
			`;
		});
	}

	$('#selectedMarkerComments').html(html);
	$('#sideCommentInput').val('');
	resetFileName('#sideCommentImageInput', '#sideCommentImageName');
}

async function saveSelectedMarkerName() {
	if (!selectedMarkerId) {
		alert('선택된 마커가 없습니다.');
		return;
	}

	const newTitle = $('#selectedMarkerNameInput').val().trim();

	if (!newTitle) {
		alert('마커 이름을 입력해주세요.');
		return;
	}

	const success = await saveMarkerNameToDb(selectedMarkerId, newTitle);

	if (!success) {
		return;
	}

	setMarkerTitle(selectedMarkerId, newTitle);

	$('#saveMarkerNameBtn').prop('disabled', true);
	$('#selectedMarkerNameInput').prop('disabled', true);

	if (currentMarker && currentMarker.__markerId === selectedMarkerId) {
		$('#markerTitleBox').html(escapeHtml(newTitle));
	}

	if ($('#allCommentsBox').hasClass('on')) {
		renderAllComments();
	}

	renderMarkerCommentsPanel(selectedMarkerId);
}

/* =========================
오른쪽: 전체 댓글 패널
========================= */

function renderAllComments() {
	let html = '';
	let hasComments = false;

	for (const markerId in markerComments) {
		const comments = markerComments[markerId];

		if (!comments || comments.length === 0) continue;

		hasComments = true;

		const markerTitle = getMarkerTitle(markerId);

		html += `<li class="all-comments-marker-li" data-markerid="${markerId}" style="cursor:pointer;">`;
		html += `<strong class="marker-group-title">${escapeHtml(markerTitle || '마커 이름 없음')}</strong>`;
		html += `<ul class="marker-group-comments">`;

		comments.forEach(function(comment, idx) {
			const commentText = typeof comment === 'string' ? comment : comment.text;
			const createdAt = typeof comment === 'string' ? '' : formatDate(comment.createdAt);
			const imageUrl = typeof comment === 'string' ? '' : (comment.imageUrl || '');
			const nickname = typeof comment === 'string' ? '' : (comment.nickname || '');

			html += `
				<li>
					<div class="comment-content">
						<span class="comment-text">${escapeHtml(commentText)}</span>
						${imageUrl ? `<img src="${imageUrl}" alt="첨부 이미지" class="comment-image">` : ''}
						${nickname || createdAt ? `<span class="comment-meta">${escapeHtml(nickname)}${nickname && createdAt ? ' · ' : ''}${createdAt}</span>` : ''}
					</div>
					<button class="delete-comment-btn" data-marker="${markerId}" data-idx="${idx}">삭제</button>
				</li>
			`;
		});

		html += `</ul></li>`;
	}

	if (!hasComments) {
		html = '<li style="color:#888;">아직 등록된 댓글이 없습니다.</li>';
	}

	$('#allCommentsList').html(html);
	$('#allCommentsBox').addClass('on').show();
}

/* =========================
검색
========================= */

function renderSearchResults(data) {
	let html = '<ul>';

	for (let i = 0; i < data.length; i++) {
		const place = data[i];
		const addr =
			(place.road_address_name || '') +
			(place.road_address_name && place.address_name ? ' / ' : '') +
			(place.address_name || '');

		html += `
			<li data-idx="${i}">
				<span class="search-place-name">${escapeHtml(place.place_name)}</span>
				<span class="search-addr">${escapeHtml(addr)}</span>
			</li>
		`;
	}

	html += '</ul>';

	$('#searchResults').html(html).show();
}

function createSearchMarkers(data) {
	clearSearchMarkers();

	for (let i = 0; i < Math.min(10, data.length); i++) {
		const place = data[i];
		const latlng = new kakao.maps.LatLng(place.y, place.x);
		const marker = new kakao.maps.Marker({
			position: latlng,
			map: map,
			title: place.place_name
		});

		searchMarkers.push(marker);

		kakao.maps.event.addListener(marker, 'click', async function() {
			map.setLevel(3);
			map.panTo(marker.getPosition());

			const locationInfo = await resolveLocationIdentity(marker.getPosition(), place);
			const markerId = locationInfo.key;

			let realMarker = markerMap[markerId];

			if (!realMarker) {
				const markerLatLng = await getMarkerPositionByLocationKey(markerId, marker.getPosition());

				realMarker = createMarker(markerLatLng || marker.getPosition(), {
					markerId: markerId,
					title: locationInfo.title || place.place_name || ''
				});
			} else if (locationInfo.title && !getMarkerTitle(markerId)) {
				setMarkerTitle(markerId, locationInfo.title);
			}

			clearSearchMarkers();
			await showCommentBox(realMarker, realMarker.getPosition());
		});
	}
}

function moveMapToSearchResults(data) {
	const bounds = new kakao.maps.LatLngBounds();

	for (let i = 0; i < Math.min(10, data.length); i++) {
		bounds.extend(new kakao.maps.LatLng(data[i].y, data[i].x));
	}

	map.setBounds(bounds);
}

function handleSearch(query) {
	$('#searchResults').hide().empty();
	clearSearchMarkers();

	if (!query) {
		alert('검색어를 입력하세요!');
		return;
	}

	ps.keywordSearch(query, function(data, status) {
		if (status === kakao.maps.services.Status.OK) {
			searchResults = data;
			renderSearchResults(data);
			createSearchMarkers(data);
			moveMapToSearchResults(data);
		} else {
			$('#searchResults').html('<div style="padding:18px; color:#888;">검색 결과가 없습니다.</div>').show();
		}
	}, { size: 10 });
}

function bindSearchResultEvents() {
	$('#searchResults').off('click', 'li').on('click', 'li', async function() {
		const idx = $(this).data('idx');
		const place = searchResults[idx];
		const latlng = new kakao.maps.LatLng(place.y, place.x);

		clearSearchMarkers();
		map.setLevel(3);
		map.panTo(latlng);

		const locationInfo = await resolveLocationIdentity(latlng, place);
		const markerId = locationInfo.key;

		let marker = markerMap[markerId];

		if (!marker) {
			const markerLatLng = await getMarkerPositionByLocationKey(markerId, latlng);

			marker = createMarker(markerLatLng || latlng, {
				markerId: markerId,
				title: locationInfo.title || place.place_name || ''
			});
		} else if (locationInfo.title && !getMarkerTitle(markerId)) {
			setMarkerTitle(markerId, locationInfo.title);
		}

		await showCommentBox(marker, marker.getPosition());
		$('#searchResults').hide();
	});
}

/* =========================
이벤트 바인딩
========================= */

$('#searchInput').on('keypress', function(e) {
	if (e.which === 13) {
		e.preventDefault();
		$('#searchBtn').click();
	}
});

$('#searchBtn').on('click', function() {
	const query = $('#searchInput').val().trim();
	handleSearch(query);
});

$(document).on('mousedown', function(e) {
	if (!$(e.target).closest('#searchContainer').length && !$(e.target).closest('#searchResults').length) {
		$('#searchResults').hide();
	}
});

$('#addCommentBtn').on('click', async function() {
	const success = await addComment();

	if (success) {
		$('.comment-box').hide();
	}
});

$('#commentInput').on('keypress', async function(e) {
	if (e.which === 13) {
		e.preventDefault();
		const success = await addComment();

		if (success) {
			$('.comment-box').hide();
		}
	}
});

$('#sideAddCommentBtn').on('click', async function() {
	await addCommentFromSidePanel();
});

$('#sideCommentInput').on('keypress', async function(e) {
	if (e.which === 13) {
		e.preventDefault();
		await addCommentFromSidePanel();
	}
});

$('#saveMarkerNameBtn').on('click', function() {
	saveSelectedMarkerName();
});

$('#selectedMarkerNameInput').on('keypress', function(e) {
	if (e.which === 13) {
		e.preventDefault();
		saveSelectedMarkerName();
	}
});

$('#commentsList').on('click', '.delete-comment-btn', async function() {
	const markerId = $(this).data('marker');
	const idx = $(this).data('idx');
	await deleteComment(markerId, idx);
});

$('#selectedMarkerComments').on('click', '.delete-comment-btn', async function() {
	const markerId = $(this).data('marker');
	const idx = $(this).data('idx');
	await deleteComment(markerId, idx);
});

$('#allCommentsList').on('click', '.delete-comment-btn', async function(e) {
	e.stopPropagation();
	const markerId = $(this).data('marker');
	const idx = $(this).data('idx');
	await deleteComment(markerId, idx);
});

$('#closeCommentBox').on('click', function() {
	$('#commentInput').val('');
	resetFileName('#commentImageInput', '#commentImageName');
	hideCommentBox();
});

$('#showAllCommentsBtn').on('click', function() {
	renderAllComments();
});

$('#closeAllComments').on('click', function() {
	$('#allCommentsBox').removeClass('on').hide();
});

$('#closeMarkerComments').on('click', function() {
	$('#markerCommentsBox').removeClass('on').hide();
	selectedMarkerId = null;
});

$('#allCommentsList').on('click', '.all-comments-marker-li', async function(e) {
	if ($(e.target).is('input,button')) {
		return;
	}

	const markerId = $(this).data('markerid');
	const marker = markerMap[markerId];

	if (marker) {
		const pos = marker.getPosition();
		map.setLevel(3);
		map.panTo(pos);
		await showCommentBox(marker, pos);
	}
});

async function getCurrentUser() {
	if (!window.supabaseClient) {
		console.error('Supabase 클라이언트가 초기화되지 않았습니다.');
		return null;
	}

	const { data, error } = await window.supabaseClient.auth.getUser();

	if (error) {
		console.error(error);
		return null;
	}

	return data.user;
}

/* =========================
Supabase DB 저장 / 조회
========================= */

async function saveCommentToDb(markerId, text, imageUrl = '', latlng = null) {
	const user = await getCurrentUser();

	if (!user) {
		alert('로그인 후 이용해주세요.');
		return null;
	}

	const profile = await getMyProfile();
	const nickname = profile && profile.nickname ? profile.nickname : user.email;

	const insertData = {
		marker_id: markerId,
		user_id: user.id,
		nickname: nickname,
		text: text,
		image_url: imageUrl,
		marker_name: getMarkerTitle(markerId) || ''
	};

	if (latlng) {
		insertData.lat = Number(latlng.getLat());
		insertData.lng = Number(latlng.getLng());
	}

	const { data, error } = await window.supabaseClient
		.from('comments')
		.insert(insertData)
		.select()
		.single();

	if (error) {
		console.error(error);
		alert('DB 저장 실패');
		return null;
	}

	return data;
}

async function saveMarkerNameToDb(markerId, markerName) {
	const user = await getCurrentUser();

	if (!user) {
		alert('로그인 후 이용해주세요.');
		return false;
	}

	const { error } = await window.supabaseClient
		.from('comments')
		.update({
			marker_name: markerName
		})
		.eq('marker_id', markerId)
		.is('deleted_at', null);

	if (error) {
		console.error(error);
		alert('마커 이름 저장 실패');
		return false;
	}

	return true;
}

async function softDeleteCommentToDb(commentId) {
	const user = await getCurrentUser();

	if (!user) {
		alert('로그인 후 이용해주세요.');
		return false;
	}

	const { error } = await window.supabaseClient
		.from('comments')
		.update({
			deleted_at: new Date().toISOString()
		})
		.eq('id', commentId)
		.eq('user_id', user.id);

	if (error) {
		console.error(error);
		alert('댓글 삭제 처리 실패');
		return false;
	}

	return true;
}

async function loadCommentsByMarkerId(markerId) {
	const { data, error } = await window.supabaseClient
		.from('comments')
		.select('*')
		.eq('marker_id', markerId)
		.is('deleted_at', null)
		.order('created_at', { ascending: true });

	if (error) {
		console.error(error);
		alert('댓글 불러오기 실패');
		return [];
	}

	return (data || []).map(normalizeCommentRow);
}

async function loadAllCommentsFromDb() {
	const { data, error } = await window.supabaseClient
		.from('comments')
		.select('*')
		.is('deleted_at', null)
		.order('created_at', { ascending: true });

	if (error) {
		console.error(error);
		alert('전체 댓글 불러오기 실패');
		return;
	}

	for (const markerId in markerComments) {
		markerComments[markerId] = [];
	}

	(data || []).forEach(function(row) {
		if (!row.marker_id) return;

		if (!markerComments[row.marker_id]) {
			markerComments[row.marker_id] = [];
		}

		markerComments[row.marker_id].push(normalizeCommentRow(row));

		if (row.marker_name && !getMarkerTitle(row.marker_id)) {
			setMarkerTitle(row.marker_id, row.marker_name);
		}
	});
}

async function loadMarkersFromDb() {
	const { data, error } = await window.supabaseClient
		.from('comments')
		.select('marker_id, lat, lng, marker_name')
		.is('deleted_at', null);

	console.log('loadMarkersFromDb data:', data);
	console.log('loadMarkersFromDb error:', error);

	if (error) {
		console.error(error);
		alert('마커 불러오기 실패');
		return;
	}

	const markerMapFromDb = new Map();

	(data || []).forEach(function(row) {
		if (!row.marker_id) return;
		if (row.lat == null || row.lng == null) return;

		if (!markerMapFromDb.has(row.marker_id)) {
			markerMapFromDb.set(row.marker_id, {
				markerId: row.marker_id,
				lat: Number(row.lat),
				lng: Number(row.lng),
				title: row.marker_name || ''
			});
		}
	});

	console.log('복원 대상 마커 목록:', Array.from(markerMapFromDb.values()));

	for (const item of markerMapFromDb.values()) {
		if (Number.isNaN(item.lat) || Number.isNaN(item.lng)) continue;
		if (markerMap[item.markerId]) continue;

		const fallbackLatLng = new kakao.maps.LatLng(item.lat, item.lng);
		const markerLatLng = await getMarkerPositionByLocationKey(item.markerId, fallbackLatLng);

		createMarker(markerLatLng || fallbackLatLng, {
			markerId: item.markerId,
			title: item.title || ''
		});

		if (item.title) {
			setMarkerTitle(item.markerId, item.title);
		}
	}
}

async function initMapPage() {
	bindSearchResultEvents();

	const user = await getCurrentUser();
	console.log('init user:', user);

	await loadMarkersFromDb();
	await loadAllCommentsFromDb();
}

/* 파일명 표시 바인딩 */
bindFileName('#commentImageInput', '#commentImageName');
bindFileName('#sideCommentImageInput', '#sideCommentImageName');

/* =========================
지도 이벤트
========================= */

kakao.maps.event.addListener(map, 'click', async function(mouseEvent) {
	clearSearchMarkers();
	hideSidePanels();

	const latlng = mouseEvent.latLng;
	const locationInfo = await resolveLocationIdentity(latlng);
	const markerId = locationInfo.key;

	hideCommentBox();
	map.setCenter(latlng);

	if (markerId && markerMap[markerId]) {
		const existingMarker = markerMap[markerId];

		if (locationInfo.title && !getMarkerTitle(markerId)) {
			setMarkerTitle(markerId, locationInfo.title);
		}

		await showCommentBox(existingMarker, existingMarker.getPosition());
		return;
	}

	showCommentBoxAt(latlng);
	updateCommentBoxPosition(latlng);
});

kakao.maps.event.addListener(map, 'zoom_changed', function() {
	updateCommentBoxPosition();
});

kakao.maps.event.addListener(map, 'center_changed', function() {
	updateCommentBoxPosition();
});

kakao.maps.event.addListener(map, 'idle', function() {
	updateCommentBoxPosition();
});

initMapPage();