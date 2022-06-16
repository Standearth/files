(function($) {
  $(document).ready(function() {
 
 // Some early initialization -- this is normally overridden by the individual petition,
 // but set some generic defaults just in case
    if($('.en__socialShares .en__socialShare--facebook').attr('href'))
     var twitterShare = $('.en__socialShares .en__socialShare--twitter').attr('href') || {
       message: "I just signed this petition -- will you please join me? " + encodeURIComponent(window.location.href),
       showOnMobile: false
     }
     var whatsappShare = $('.en__socialShares .en__socialShare--whatsapp').attr('href') || {
       message: "Hi, I just signed this petition with Stand.earth: "+ $('.page_title').html() + " at " + window.location.href + ". It would mean a lot to me if you took a moment to add your name. Thanks!",
       showOnMobile: true
     }
     var emailShare = emailShare || {
       subject: encodeURI($('.page_title').html()),
       message: encodeURI($('.en__component--copyblock').text() + "Take action at: " + window.location.href),
       showOnMobile: true
     }
     var facebookShare = $('.en__socialShares .en__socialShare--facebook').attr('href') || {
       url: encodeURIComponent(window.location.href)+'%26en_chan%3Dfb%26ea.tracking.id%3Dfb-share'
     }
     
     // set up facebook preview image
     var img = $('<img id="facebook_indi_img">');
     $('.facebook_image').html('');
     img.attr('src', $('meta[property="og:image"]').attr('content'));
     img.appendTo('.facebook_image');
     $('.facebook_title').html($('meta[property="og:title"]').attr('content'));
     $('.facebook_desc').html($('meta[property="og:description"]').attr('content'));
     
       // slide to a new section on the thankyou page
     $('.slide').click(function (e) {
     if ($(this).data('slide') == '#thankyou_stage3_donate') {
       donate_redirect();
     } else {
       var scroll_to = $(this).data('slide');
       $(scroll_to).show();
       $(scroll_to).parent().show();
       $('html, body').animate({
         scrollTop: $(scroll_to).offset().top - 5
       }, 800);
     }
     return false;
     });
     
     
     // Clicks on social media sharing buttons
     $('.share_btn').on('click', function (e) {
     if ($(this).hasClass('facebook')) {
       window.open(facebookShare, 'height=450, width=550, top=' + ($(window).height() / 2 - 275) + ', left=' + ($(window).width() / 2 - 225) + ', toolbar=0, location=0, menubar=0, directories=0, scrollbars=0'); 

     } else if ($(this).hasClass('twitter')) {
        window.open(twitterShare, 'twShareWindow', 'height=450, width=550, top=' + ($(window).height() / 2 - 275) + ', left=' + ($(window).width() / 2 - 225) + ', toolbar=0, location=0, menubar=0, directories=0, scrollbars=0');
        
     } else if ($(this).hasClass('whatsapp')) {
        window.open('whatsapp://send?text=' + encodeURIComponent(whatsappShare.message));

     } else if ($(this).hasClass('email')) {
        window.open('mailto:?subject='+emailShare.subject+'&body='+emailShare.message);
     }
     return false;
     });
 
 // log a custom event click
   $('.gtm_event').click(function () {
     if ($(this).data('event')) {
 
       if ($(this).hasClass('donate')) {
 
         // donation buttons need to be handled specially, so we can set the donation value.
         // the donation redirect also needs to happen in a callback to ensure the tracking event completes first
         $('.donate_clicked').removeClass('donate_clicked');
         $(this).addClass('donate_clicked');
 
         var amt = $(this).html().replace(/\D/g, '');
         dataLayer.push({
           'event': $(this).data('event'),
           'petition-scroll-value': amt,
           'eventCallback': donate_redirect
         });
 
       } else {
         dataLayer.push({ 'event': $(this).data('event') });
       }
     }
   });

// default donate url
  var donateurl = 'https://act.stand.earth/page/10790/donate/1?xvar=scroll';    

 // catch the engaging networks form submission, and add some custom post-submit
 // behaviour that overrides the default redirect
   window.enOnSubmit = function () {
     if ($('div.en__field__error').length < 1) {
       // disable submit button to prevent double-click submissions
       $('.en__submit button').addClass('disabled');
       $('body').removeClass('fixed-top');
 
       // do submission as an AJAX call, to retain single-page scrolling for thankyou section
       $.ajax({
         method: 'POST',
         url: $('form.en__component--page').attr('action'),
         data: $('form.en__component--page').serialize()
       })
         .done(function (msg) {
           donateurl = msg.match(/\bhttps?:\/\/\S+donate+/gi)[0]+'/1?chain&xvar=scroll';
           if (~msg.indexOf('"pageType":"donation"')) {
             if (typeof customCodeSignupComplete === 'function') {
               customCodeSignupComplete();
             }
 
             // this is the new post-signing flow tracking
             dataLayer.push({ 'event': 'petition-scroll-init' });
 
             // customize the post-signing messages with the supporter's name
             $('.firstname_merge').text($('#en__field_supporter_firstName').val());
 
             // slide to the next thankyou section
             // (can't use the generic slide function above since this relies on AJAX returning success first)
             $('#thankyou_stage1_yesno').show();
 
             var newSlide = $('.thank-you').parent();
             newSlide.addClass('show');
             newSlide.show();
 
             $('html, body').animate({
               scrollTop: $('#thankyou_stage1_yesno').offset().top - 20
             }, 800);
 
           } else {
             // FIXME: can we display the actual error message instead of a generic alert?
             console.log('error');
             alert("Unable to submit - please try again");
             $('.en__submit button').removeClass('disabled');
           }
         })
         .fail(function () {
           alert("Unable to submit - please try again");
           $('.en__submit button').removeClass('disabled');
         });
     } else {
         console.log('errors');
     }
 
     return false;
   };

  async function getPageInfo(query) {
    if (query == 'All') {
      $.ajax({
        url: "https://stand-en-api.herokuapp.com/api/pages",
        }).done(function(data){
        console.log(data);
        return data;
        });
    } else {
      $.ajax({
        url: "https://stand-en-api.herokuapp.com/api/pages?"+query,
        }).done(function(data){
          console.log(data);
        return data;
        }); 
    }
  }
  
  function loadDaisyChain() {
    // Check if data-pages attriute exists
    var pages = $('.dc_btns').data('pages').split(',');
    if (pages.length > 0) {
      // Pull info on data-pages 
      pages.forEach(function(d,i) {
        getPageInfo("id="+d).then(function(v,e) {
          console.log(v);
          var el = '<div class="dc_btn gtm_event" data-event="petition-scroll-dc_1" id="dc1"><div class="overlay"><a href="https://act.stand.earth/page/35202/petition/1?chain&amp;ea.tracking.id=act-page&amp;xvar=dc" target="_new"><div class="dc_content"><h2>Sign now: Stop burning trees for electricity</h2></div><div class="dc_cta"><h3>Take action</h3></div></a></div></div>'
        });
      })
    } else {
      // Get current page ID and info
      var page_id = window.location.href.split('act.stand.earth/page/')[1].split('/')[0];
      getPageInfo("id="+page_id).then(function(v,e) {
        console.log(v);
      });
      
      // Get related or random pages from the API

    }


    
    
    // Populate daisy chain boxes
    
  }

  loadDaisyChain()
   
  function donate_redirect() {
    location.href = donateurl;
 }
   
});
})(jQuery);