function getTodayString() {
	const now = new Date();

	return now.getFullYear() + '-' +
		String(now.getMonth() + 1).padStart(2, '0') + '-' +
		String(now.getDate()).padStart(2, '0');
}

async function checkLoginExpire() {
	const savedDate = localStorage.getItem('loginDate');

	if (!savedDate) return;

	const today = getTodayString();

	if (savedDate !== today) {
		console.log('날짜 변경으로 자동 로그아웃');

		if (window.supabaseClient) {
			await window.supabaseClient.auth.signOut();
		}

		localStorage.removeItem('loginDate');
	}
}

async function signUp(email, password, nickname) {
	const { data, error } = await window.supabaseClient.auth.signUp({
		email,
		password
	});

	if (error) {
		if (error.message.includes('User already registered')) {
			alert('이미 가입된 이메일입니다. 로그인해주세요.');
			return null;
		}

		alert(error.message);
		return null;
	}

	if (!data.user) {
		alert('회원가입 사용자 정보를 가져오지 못했습니다.');
		return null;
	}

	const { error: profileError } = await window.supabaseClient
		.from('profiles')
		.insert([
			{
				id: data.user.id,
				nickname: nickname
			}
		]);

	if (profileError) {
		alert(profileError.message);
		return null;
	}

	return data;
}

async function signIn(email, password) {
	const { data, error } = await window.supabaseClient.auth.signInWithPassword({
		email,
		password
	});

	if (error) {
		alert('이메일 또는 비밀번호를 확인해주세요.');
		return null;
	}

	localStorage.setItem('loginDate', getTodayString());

	return data;
}

async function signOutUser() {
	const { error } = await window.supabaseClient.auth.signOut();

	if (error) {
		alert(error.message);
		return false;
	}

	localStorage.removeItem('loginDate');

	return true;
}

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

async function getMyProfile() {
	const user = await getCurrentUser();

	if (!user) return null;

	const { data, error } = await window.supabaseClient
		.from('profiles')
		.select('nickname')
		.eq('id', user.id)
		.single();

	if (error) {
		console.error(error);
		return null;
	}

	return data;
}

async function updateAuthUI() {
	const user = await getCurrentUser();

	if (!user) {
		$('#openAuthBtn').show();
		$('#userMenu').hide();
		$('#authWrap').hide();

		$('.auth-tab-btn').removeClass('on');
		$('.auth-tab-btn[data-tab="login"]').addClass('on');

		$('.auth-panel').removeClass('on');
		$('#loginPanel').addClass('on');

		return;
	}

	const profile = await getMyProfile();
	const name = profile && profile.nickname ? profile.nickname : user.email;

	$('#loginStatus').text(name + ' 로그인 중');
	$('#openAuthBtn').hide();
	$('#userMenu').show();
	$('#authWrap').hide();
}

$(document).ready(async function() {
	await checkLoginExpire();
	await updateAuthUI();

	$('#signupBtn').on('click', async function() {
		const nickname = $('#signupNickname').val().trim();
		const email = $('#signupEmail').val().trim();
		const password = $('#signupPassword').val().trim();

		if (!nickname || !email || !password) {
			alert('닉네임, 이메일, 비밀번호를 입력해주세요.');
			return;
		}

		const result = await signUp(email, password, nickname);

		if (!result) return;

		alert('회원가입이 완료되었습니다.');
		await updateAuthUI();
	});

	$('#loginBtn').on('click', async function() {
		const email = $('#loginEmail').val().trim();
		const password = $('#loginPassword').val().trim();

		if (!email || !password) {
			alert('이메일과 비밀번호를 입력해주세요.');
			return;
		}

		const result = await signIn(email, password);

		if (!result) return;

		alert('로그인되었습니다.');
		await updateAuthUI();
	});

	$('#logoutBtn').on('click', async function() {
		const ok = await signOutUser();

		if (!ok) return;

		alert('로그아웃되었습니다.');
		await updateAuthUI();
	});

	$('#openAuthBtn').on('click', function() {
		$('#authWrap').show();
	});

	$('#closeAuthBtn').on('click', function() {
		$('#authWrap').hide();
	});

	$(document).on('click', '.auth-tab-btn', function() {
		const tab = $(this).data('tab');

		$('.auth-tab-btn').removeClass('on');
		$(this).addClass('on');

		$('.auth-panel').removeClass('on');

		if (tab === 'login') {
			$('#loginPanel').addClass('on');
		} else {
			$('#signupPanel').addClass('on');
		}
	});

	window.supabaseClient.auth.onAuthStateChange(async function(event, session) {
		if (event === 'SIGNED_IN') {
			localStorage.setItem('loginDate', getTodayString());
		}

		if (event === 'SIGNED_OUT') {
			localStorage.removeItem('loginDate');
		}

		await updateAuthUI();
	});
});